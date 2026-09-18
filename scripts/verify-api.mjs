#!/usr/bin/env node
/**
 * Checks the live TypeSafe API against every assumption this node is built on.
 *
 * The transport was written from the compiled `@typesafe-ai/sdk` bundle, not from
 * a live call, so each assumption below is unverified until this runs green.
 * Every check names the file that breaks if it fails.
 *
 *   TYPESAFE_API_KEY=sk-... node scripts/verify-api.mjs
 *
 * Exits 0 when every assumption holds, 1 otherwise. Costs one systemOne call.
 */

const API_KEY = process.env.TYPESAFE_API_KEY;
const BASE_URL = (process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai').replace(/\/+$/, '');

if (!API_KEY) {
	console.error('Set TYPESAFE_API_KEY first. Nothing was sent.');
	process.exit(1);
}

const checks = [];
const record = (ok, name, where, detail) => checks.push({ ok, name, where, detail });

const headers = {
	Authorization: `Bearer ${API_KEY}`,
	Accept: 'application/json',
	'Content-Type': 'application/json',
	'User-Agent': 'n8n-nodes-typesafe-jev/verify',
};

async function call(method, path, body) {
	const response = await fetch(`${BASE_URL}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	let parsed;
	const text = await response.text();
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}
	return { status: response.status, headers: response.headers, body: parsed };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// --- 1. Auth and the models endpoint ---------------------------------------
console.log(`→ GET ${BASE_URL}/v1/models`);
const models = await call('GET', '/v1/models');

record(
	models.status === 200,
	'Bearer token is the accepted auth scheme',
	'credentials/TypeSafeApi.credentials.ts (authenticate)',
	`got HTTP ${models.status}`,
);
record(
	Array.isArray(models.body),
	'GET /v1/models returns a bare array, not an envelope',
	'nodes/TypeSafeJev/transport.ts listModels',
	Array.isArray(models.body) ? `${models.body.length} models` : `got ${typeof models.body}`,
);
record(
	Array.isArray(models.body) && models.body.every((m) => typeof m?.name === 'string'),
	'every model card carries a string name',
	'TypeSafeJev.node.ts getModels',
	Array.isArray(models.body) ? models.body.map((m) => m?.name).join(', ') : 'n/a',
);
record(
	models.status === 200,
	'the credential Test endpoint answers 200',
	'credentials/TypeSafeApi.credentials.ts (test)',
	`GET /v1/models -> ${models.status}`,
);

const modelName = Array.isArray(models.body) && models.body[0]?.name ? models.body[0].name : 'jev-latest';

// --- 2. systemOne, one question of each type -------------------------------
const payload = {
	model: modelName,
	state: { ticket: 'I was charged twice and nobody has replied in three days.', tier: 'pro' },
	questions: {
		intent: {
			type: 'choice',
			instructions: 'What is the primary request?',
			criteria: { refund: 'Wants money returned.', help: 'Wants something fixed.', info: null },
		},
		urgent: {
			type: 'noul',
			instructions: 'Does the customer convey time pressure?',
		},
		frustration: {
			type: 'score',
			instructions: 'How frustrated is the customer?',
			criteria: ['Calm or neutral', 'Concerned but civil', 'Very angry'],
		},
	},
};

console.log(`→ POST ${BASE_URL}/v1/systemone (model: ${modelName})`);
const result = await call('POST', '/v1/systemone', payload);

record(
	result.status === 200,
	'POST /v1/systemone accepts { model, state, questions }',
	'nodes/TypeSafeJev/transport.ts systemOne',
	`got HTTP ${result.status}`,
);
record(
	typeof result.body?.model === 'string' && result.body?.answers && result.body?.usage,
	'response is { model, answers, usage } at the top level',
	'TypeSafeJev.node.ts execute (payload assembly)',
	`keys: ${result.body && typeof result.body === 'object' ? Object.keys(result.body).join(', ') : typeof result.body}`,
);
record(
	typeof result.body?.answers === 'object' &&
		['intent', 'urgent', 'frustration'].every((k) => k in (result.body.answers ?? {})),
	'answers are keyed by the question names we sent',
	'README output examples',
	`keys: ${Object.keys(result.body?.answers ?? {}).join(', ')}`,
);

const a = result.body?.answers ?? {};
record(
	a.intent?.type === 'choice' && typeof a.intent?.choice === 'string' && isNum(a.intent?.confidence) && a.intent?.probabilities,
	'choice answer: { type, choice, confidence, probabilities }',
	'nodes/TypeSafeJev/types.ts ChoiceAnswer, simplifyAnswer',
	JSON.stringify(a.intent),
);
record(
	a.urgent?.type === 'noul' && isNum(a.urgent?.noul),
	'noul answer: { type, noul }',
	'nodes/TypeSafeJev/types.ts NoulAnswer, simplifyAnswer',
	JSON.stringify(a.urgent),
);
record(
	a.frustration?.type === 'score' && isNum(a.frustration?.score) && a.frustration?.legend && a.frustration?.probabilities,
	'score answer: { type, score, confidence, legend, probabilities }',
	'nodes/TypeSafeJev/types.ts ScoreAnswer, simplifyAnswer',
	JSON.stringify(a.frustration),
);
record(
	isNum(result.body?.usage?.input_tokens) && isNum(result.body?.usage?.output_tokens),
	'usage uses snake_case input_tokens / output_tokens',
	'README output description',
	JSON.stringify(result.body?.usage),
);
record(
	Boolean(result.headers.get('x-typesafe-request-id')),
	'x-typesafe-request-id is returned on success',
	'transport.ts REQUEST_ID_HEADER, Include Request ID option',
	result.headers.get('x-typesafe-request-id') ?? 'absent',
);
// `urgent` above deliberately omits `criteria` entirely, which is what the
// builder emits when neither outcome is described.
record(
	a.urgent?.type === 'noul',
	'a noul question is accepted with no criteria key at all',
	'questions.ts buildQuestions (noul branch)',
	a.urgent ? 'accepted' : 'no answer returned for the criteria-less question',
);

// --- 3. Error shape --------------------------------------------------------
console.log('→ POST /v1/systemone with a bogus model (expecting a 4xx)');
const failure = await call('POST', '/v1/systemone', { ...payload, model: 'definitely-not-a-model' });

record(
	failure.status >= 400 && failure.status < 500,
	'an unknown model is rejected with a 4xx',
	'transport.ts toApiError',
	`got HTTP ${failure.status}`,
);
record(
	typeof failure.body?.error?.message === 'string' || typeof failure.body?.message === 'string',
	'error body exposes error.message or message',
	'transport.ts toApiError (description)',
	JSON.stringify(failure.body)?.slice(0, 200),
);
record(
	Boolean(failure.headers.get('x-typesafe-request-id')),
	'x-typesafe-request-id is returned on failure too',
	'transport.ts toApiError (request ID in description)',
	failure.headers.get('x-typesafe-request-id') ?? 'absent',
);

// --- Report ----------------------------------------------------------------
console.log('');
for (const c of checks) {
	console.log(`${c.ok ? ' PASS' : ' FAIL'}  ${c.name}`);
	if (!c.ok) {
		console.log(`        breaks: ${c.where}`);
		console.log(`        saw:    ${c.detail}`);
	}
}

const failed = checks.filter((c) => !c.ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} assumptions hold.`);

if (failed.length > 0) {
	console.log('\nFull systemOne response for reference:');
	console.log(JSON.stringify(result.body, null, 2));
	process.exit(1);
}
