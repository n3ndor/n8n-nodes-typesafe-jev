import { describe, expect, it, vi } from 'vitest';

import { TypeSafeJev } from '../nodes/TypeSafeJev/TypeSafeJev.node';

const RESPONSE = {
	body: {
		model: 'jev-1',
		answers: {
			intent: { type: 'choice', choice: 'refund', confidence: 0.9, probabilities: { refund: 0.9 } },
			urgent: { type: 'noul', noul: 0.8 },
			anger: { type: 'score', score: 1.4, confidence: 0.7, legend: {}, probabilities: {} },
		},
		usage: { input_tokens: 10, output_tokens: 3 },
	},
	headers: { 'x-typesafe-request-id': 'req_123' },
	statusCode: 200,
};

interface Ctx {
	params: Record<string, unknown>;
	items?: Array<{ json: Record<string, unknown> }>;
	httpRequest?: ReturnType<typeof vi.fn>;
	continueOnFail?: boolean;
}

/**
 * Runs execute() with the clock faked, so a test that exercises the retry backoff
 * finishes instantly instead of really sleeping between attempts.
 */
async function executeWithoutWaiting(context: unknown) {
	vi.useFakeTimers();
	try {
		const running = TypeSafeJev.prototype.execute.call(context as never);
		const settled = running.then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		await vi.runAllTimersAsync();
		const outcome = await settled;
		if ('error' in outcome) throw outcome.error;
		return outcome.value;
	} finally {
		vi.useRealTimers();
	}
}

function makeContext(ctx: Ctx) {
	const httpRequest = ctx.httpRequest ?? vi.fn().mockResolvedValue(RESPONSE);
	const items = ctx.items ?? [{ json: { ticket: 'T-1' } }];

	return {
		httpRequest,
		context: {
			getInputData: () => items,
			getNode: () => ({ name: 'TypeSafe Jev', type: 'typeSafeJev', typeVersion: 1 }),
			continueOnFail: () => ctx.continueOnFail ?? false,
			getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.typesafe.ai' }),
			getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
				name in ctx.params ? ctx.params[name] : fallback,
			helpers: { httpRequestWithAuthentication: httpRequest },
		},
	};
}

const BUILDER_PARAMS = {
	model: 'jev-1',
	state: '={{ $json }}',
	questionInput: 'builder',
	output: 'append',
	simplify: false,
	options: {},
	questions: {
		questionValues: [
			{
				name: 'intent',
				type: 'choice',
				instructions: 'What do they want?',
				choiceCriteria: { values: [{ label: 'refund' }, { label: 'help' }] },
			},
		],
	},
};

describe('TypeSafeJev.execute', () => {
	it('posts the built schema to /v1/systemone and appends the response', async () => {
		const { context, httpRequest } = makeContext({
			params: { ...BUILDER_PARAMS, state: { ticket: 'T-1' } },
		});

		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		const [, sent] = httpRequest.mock.calls[0];
		expect(sent.url).toBe('https://api.typesafe.ai/v1/systemone');
		expect(sent.method).toBe('POST');
		expect(sent.body).toEqual({
			model: 'jev-1',
			state: { ticket: 'T-1' },
			questions: {
				intent: {
					type: 'choice',
					instructions: 'What do they want?',
					criteria: { refund: null, help: null },
				},
			},
		});

		expect(output[0].json.ticket).toBe('T-1');
		expect(output[0].json.typesafeJev).toHaveProperty('answers.intent.choice', 'refund');
		expect(output[0].pairedItem).toEqual({ item: 0 });
	});

	it('parses a hand-typed JSON questions schema instead of rejecting it', async () => {
		const { context, httpRequest } = makeContext({
			params: {
				...BUILDER_PARAMS,
				questionInput: 'json',
				questionsJson: '{"urgent":{"type":"noul","instructions":"Urgent?"}}',
				state: 'Please help, this is blocking us.',
			},
		});

		await TypeSafeJev.prototype.execute.call(context as never);

		const [, sent] = httpRequest.mock.calls[0];
		expect(sent.body.questions).toEqual({ urgent: { type: 'noul', instructions: 'Urgent?' } });
		expect(sent.body.state).toBe('Please help, this is blocking us.');
	});

	it('sends a hand-typed JSON state as structured data, not a string', async () => {
		const { context, httpRequest } = makeContext({
			params: { ...BUILDER_PARAMS, state: '{"ticket":"T-9","tier":"pro"}' },
		});

		await TypeSafeJev.prototype.execute.call(context as never);

		expect(httpRequest.mock.calls[0][1].body.state).toEqual({ ticket: 'T-9', tier: 'pro' });
	});

	it('collapses answers to their primary values when simplified', async () => {
		const { context } = makeContext({
			params: { ...BUILDER_PARAMS, simplify: true, output: 'answersOnly' },
		});

		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		expect(output[0].json).toEqual({ intent: 'refund', urgent: 0.8, anger: 1.4 });
	});

	it('honours the output field name and request ID options', async () => {
		const { context } = makeContext({
			params: {
				...BUILDER_PARAMS,
				options: { outputField: 'decision', includeRequestId: true, timeout: 5000 },
			},
		});

		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		expect(output[0].json.decision).toHaveProperty('requestId', 'req_123');
	});

	it('reports an invalid schema as a configuration error, not an API error', async () => {
		const { context, httpRequest } = makeContext({
			params: {
				...BUILDER_PARAMS,
				questions: {
					questionValues: [{ name: 'anger', type: 'score', scoreCriteria: ['Calm'] }],
				},
			},
		});

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toThrow(
			/at least two rubric levels/,
		);
		expect(httpRequest).not.toHaveBeenCalled();
	});

	it('surfaces the status and request ID when the API fails', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			statusCode: 429,
			response: {
				body: { error: { message: 'Rate limit exceeded' } },
				headers: { 'x-typesafe-request-id': 'req_err' },
			},
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		// A 429 is retried now, so this runs on a faked clock to stay instant.
		await expect(executeWithoutWaiting(context)).rejects.toMatchObject({
			message: expect.stringContaining('429'),
			description: expect.stringContaining('req_err'),
		});
	});

	it('retries a rate limit and returns the answer once it clears', async () => {
		const httpRequest = vi
			.fn()
			.mockRejectedValueOnce({ statusCode: 429, response: { headers: {} } })
			.mockResolvedValue(RESPONSE);
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		const [output] = await executeWithoutWaiting(context);

		expect(httpRequest).toHaveBeenCalledTimes(2);
		expect(output[0].json.typesafeJev).toMatchObject({ model: 'jev-1' });
	});

	it('retries a dropped connection, which arrives without a status', async () => {
		const httpRequest = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
			.mockResolvedValue(RESPONSE);
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		const [output] = await executeWithoutWaiting(context);

		expect(httpRequest).toHaveBeenCalledTimes(2);
		expect(output).toHaveLength(1);
	});

	it('gives up after three attempts rather than retrying forever', async () => {
		const httpRequest = vi.fn().mockRejectedValue({ statusCode: 529, response: { headers: {} } });
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(executeWithoutWaiting(context)).rejects.toThrow(/529/);
		expect(httpRequest).toHaveBeenCalledTimes(3);
	});

	it('does not retry a rejection the caller has to fix', async () => {
		const httpRequest = vi.fn().mockRejectedValue({ statusCode: 422, response: { headers: {} } });
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(executeWithoutWaiting(context)).rejects.toThrow(/422/);
		expect(httpRequest).toHaveBeenCalledTimes(1);
	});

	it('bounds a retry-after that asks for longer than the budget allows', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			statusCode: 429,
			response: { headers: { 'retry-after': '3600' } },
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		// An hour, asked for three times, would hold the worker for three hours. The
		// header is honoured but capped, and the whole sequence stays inside its budget.
		const started = Date.now();
		await expect(executeWithoutWaiting(context)).rejects.toThrow(/429/);
		expect(Date.now() - started).toBeLessThan(60_000);
		expect(httpRequest).toHaveBeenCalledTimes(3);
	});

	it('returns an error item per failing input when Continue On Fail is set', async () => {
		const httpRequest = vi.fn().mockRejectedValue({ statusCode: 500, response: {} });
		const { context } = makeContext({
			params: BUILDER_PARAMS,
			httpRequest,
			continueOnFail: true,
		});

		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		expect(output).toHaveLength(1);
		expect(output[0].json.ticket).toBe('T-1');
		expect(output[0].json.error).toContain('500');
	});

	it('rejects an answer whose type is not the type the question was asked as', async () => {
		const httpRequest = vi.fn().mockResolvedValue({
			...RESPONSE,
			body: {
				...RESPONSE.body,
				answers: { intent: { type: 'noul', noul: 0.8 } },
			},
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		// Simplify would otherwise read the value the returned type names, so a noul in
		// place of a choice reaches the workflow as 0.8 where a label was expected.
		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			message: expect.stringContaining('wrong type'),
			description: expect.stringContaining('asked as a choice'),
		});
	});

	it('passes through an answer for a question it did not ask', async () => {
		const { context } = makeContext({ params: { ...BUILDER_PARAMS, simplify: true } });

		// RESPONSE carries urgent and anger, which BUILDER_PARAMS never asks for. There is
		// no question to check them against, and an extra field is not a broken contract.
		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		expect(output[0].json.typesafeJev).toMatchObject({
			answers: { intent: 'refund', urgent: 0.8, anger: 1.4 },
		});
	});

	it('processes every input item', async () => {
		const { context, httpRequest } = makeContext({
			params: BUILDER_PARAMS,
			items: [{ json: { ticket: 'A' } }, { json: { ticket: 'B' } }],
		});

		const [output] = await TypeSafeJev.prototype.execute.call(context as never);

		expect(httpRequest).toHaveBeenCalledTimes(2);
		expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
	});
});

describe('live wire shapes', () => {
	// Both pinned against api.typesafe.ai on 2026-09-19. The SDK types described
	// neither, and getting them wrong is silent: an empty dropdown, a blank error.
	it('reads models out of the { models: [...] } envelope', async () => {
		const httpRequest = vi.fn().mockResolvedValue({
			body: {
				models: [
					{ name: 'jev-latest', description: 'The latest one', release_date: '2026-09-10' },
					{ name: 'jev-preview', description: 'A preview', release_date: '2026-09-10' },
				],
			},
			headers: {},
			statusCode: 200,
		});
		const { context } = makeContext({ params: {}, httpRequest });

		const options = await new TypeSafeJev().methods.loadOptions.getModels.call(context as never);

		expect(options.map((o: { value: string }) => o.value)).toEqual(['jev-latest', 'jev-preview']);
	});

	it('still reads a bare array, which the SDK types describe', async () => {
		const httpRequest = vi.fn().mockResolvedValue({
			body: [{ name: 'jev-latest', description: 'x', release_date: 'y' }],
			headers: {},
			statusCode: 200,
		});
		const { context } = makeContext({ params: {}, httpRequest });

		const options = await new TypeSafeJev().methods.loadOptions.getModels.call(context as never);

		expect(options).toHaveLength(1);
	});

	it('surfaces the message from a { detail: { message } } error body', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			statusCode: 400,
			response: {
				body: { detail: { error_type: 'api_usage_error', message: 'Unknown model: nope' } },
				headers: { 'x-typesafe-request-id': 'req_detail' },
			},
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			description: expect.stringContaining('Unknown model: nope'),
		});
	});

	it('digs the body out of cause.response.data, which is where n8n puts it', async () => {
		// n8n 2.39.8 throws a NodeApiError, not the axios error, and keeps the real
		// response on `cause`. Looking only at error.response found nothing, so every
		// API failure showed axios's generic text instead of the server's message.
		const httpRequest = vi.fn().mockRejectedValue(
			Object.assign(new Error('Request failed with status code 401'), {
				name: 'NodeApiError',
				httpCode: '401',
				cause: {
					response: {
						status: 401,
						data: {
							detail: {
								error_type: 'authentication_error',
								message: 'Cannot authenticate with the server.',
							},
						},
						headers: { 'x-typesafe-request-id': 'req_cause' },
					},
				},
			}),
		);
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			message: expect.stringContaining('401'),
			description: expect.stringContaining('Cannot authenticate with the server.'),
		});
	});

	it('includes the request ID from cause.response.headers', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			httpCode: '429',
			cause: {
				response: {
					status: 429,
					data: { detail: { message: 'Rate limit exceeded' } },
					headers: { 'x-typesafe-request-id': 'req_rate' },
				},
			},
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		// Also a 429, so also retried; run it on a faked clock.
		await expect(executeWithoutWaiting(context)).rejects.toMatchObject({
			description: expect.stringContaining('req_rate'),
		});
	});

	it('does not double the period when the server message ends in one', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			httpCode: '401',
			cause: {
				response: {
					status: 401,
					data: { detail: { message: 'Cannot authenticate with the server.' } },
					headers: { 'x-typesafe-request-id': 'req_dot' },
				},
			},
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			description: 'Cannot authenticate with the server. TypeSafe request ID: req_dot',
		});
	});

	it('falls back to a plain string detail', async () => {
		const httpRequest = vi.fn().mockRejectedValue({
			statusCode: 422,
			response: { body: { detail: 'Validation failed' }, headers: {} },
		});
		const { context } = makeContext({ params: BUILDER_PARAMS, httpRequest });

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			description: expect.stringContaining('Validation failed'),
		});
	});
});

describe('TypeSafeJev.description', () => {
	it('is usable as an AI Agent tool', () => {
		expect(new TypeSafeJev().description.usableAsTool).toBe(true);
	});

	it('declares the credential the transport looks up', () => {
		expect(new TypeSafeJev().description.credentials?.[0]).toMatchObject({
			name: 'typeSafeApi',
			required: true,
		});
	});
});
