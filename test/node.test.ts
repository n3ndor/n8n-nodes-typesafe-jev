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

		await expect(TypeSafeJev.prototype.execute.call(context as never)).rejects.toMatchObject({
			message: expect.stringContaining('429'),
			description: expect.stringContaining('req_err'),
		});
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
