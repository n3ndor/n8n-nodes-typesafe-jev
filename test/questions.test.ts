import { describe, expect, it } from 'vitest';

import {
	buildQuestions,
	parseJsonParameter,
	parseState,
	validateQuestions,
	type QuestionBuilderRow,
} from '../nodes/TypeSafeJev/questions';

describe('parseJsonParameter', () => {
	// n8n hands back a string whenever the user types literal JSON into a `json`
	// field. Sending that string on was the bug that made JSON mode unusable.
	it('parses the string n8n returns for a hand-typed json field', () => {
		expect(parseJsonParameter('{"a":{"type":"noul"}}', 'Questions')).toEqual({
			a: { type: 'noul' },
		});
	});

	it('passes through a value an expression already resolved to an object', () => {
		const resolved = { a: { type: 'noul' } };
		expect(parseJsonParameter(resolved, 'Questions')).toBe(resolved);
	});

	it('treats an empty field as absent', () => {
		expect(parseJsonParameter('   ', 'Questions')).toBeUndefined();
	});

	it('names the field when the JSON is malformed', () => {
		expect(() => parseJsonParameter('{nope}', 'Questions (JSON)')).toThrow(
			'Questions (JSON) is not valid JSON',
		);
	});

	it('accepts a hand-typed JSON schema end to end', () => {
		const typed = '{"urgent":{"type":"noul","instructions":"Is this urgent?"}}';
		expect(validateQuestions(parseJsonParameter(typed, 'Questions'))).toHaveProperty(
			'urgent.type',
			'noul',
		);
	});
});

describe('parseState', () => {
	it('parses a hand-typed JSON object into structured state', () => {
		expect(parseState('{"ticket":"1"}')).toEqual({ ticket: '1' });
	});

	it('parses a hand-typed JSON array', () => {
		expect(parseState('[1,2]')).toEqual([1, 2]);
	});

	it('leaves prose alone rather than failing on it', () => {
		expect(parseState('I was charged twice. Please help.')).toBe(
			'I was charged twice. Please help.',
		);
	});

	it('keeps text that merely looks like JSON but does not parse', () => {
		expect(parseState('{not json')).toBe('{not json');
	});

	it('passes through an object an expression resolved to', () => {
		expect(parseState({ ticket: '1' })).toEqual({ ticket: '1' });
	});
});

describe('validateQuestions', () => {
	it('accepts every Jev question type', () => {
		expect(
			validateQuestions({
				intent: { type: 'choice', criteria: { billing: 'Billing issue', other: null } },
				urgent: { type: 'noul', instructions: 'Is this urgent?' },
				severity: { type: 'score', criteria: ['Low', 'High'] },
			}),
		).toHaveProperty('intent.type', 'choice');
	});

	it('rejects a non-object schema', () => {
		expect(() => validateQuestions('{"a":1}')).toThrow('non-empty JSON object');
	});

	it('rejects an empty schema', () => {
		expect(() => validateQuestions({})).toThrow('non-empty JSON object');
	});

	it('names the offending type', () => {
		expect(() => validateQuestions({ a: { type: 'ranking' } })).toThrow(
			'has type "ranking". Expected one of: choice, noul, score',
		);
	});

	it('rejects a choice with fewer than two labels', () => {
		expect(() => validateQuestions({ a: { type: 'choice', criteria: { only: null } } })).toThrow(
			'at least two criteria labels',
		);
	});

	it('rejects malformed score rubrics before an API call', () => {
		expect(() => validateQuestions({ severity: { type: 'score', criteria: ['Only one'] } })).toThrow(
			'at least two rubric levels',
		);
	});

	it('rejects non-object noul criteria', () => {
		expect(() => validateQuestions({ a: { type: 'noul', criteria: 'yes' } })).toThrow(
			'criteria must be an object',
		);
	});

	it('allows noul without criteria', () => {
		expect(validateQuestions({ a: { type: 'noul' } })).toHaveProperty('a.type', 'noul');
	});
});

describe('buildQuestions', () => {
	const choiceRow: QuestionBuilderRow = {
		name: 'intent',
		type: 'choice',
		instructions: 'What is the primary request?',
		choiceCriteria: {
			values: [
				{ label: 'refund', description: 'Wants money returned' },
				{ label: 'help', description: '' },
			],
		},
	};

	it('builds a choice question, leaving an empty description as null', () => {
		expect(buildQuestions([choiceRow])).toEqual({
			intent: {
				type: 'choice',
				instructions: 'What is the primary request?',
				criteria: { refund: 'Wants money returned', help: null },
			},
		});
	});

	it('builds a score question from the rubric level list', () => {
		expect(
			buildQuestions([{ name: 'anger', type: 'score', scoreCriteria: ['Calm', 'Annoyed', 'Livid'] }]),
		).toEqual({
			anger: { type: 'score', instructions: undefined, criteria: ['Calm', 'Annoyed', 'Livid'] },
		});
	});

	it('omits noul criteria entirely when neither outcome is described', () => {
		const built = buildQuestions([{ name: 'urgent', type: 'noul', instructions: 'Urgent?' }]);
		expect(built.urgent).toEqual({ type: 'noul', instructions: 'Urgent?' });
		expect(built.urgent).not.toHaveProperty('criteria');
	});

	it('includes noul criteria when an outcome is described', () => {
		expect(
			buildQuestions([{ name: 'urgent', type: 'noul', noulTrue: 'Asks for immediate action' }]),
		).toHaveProperty('urgent.criteria', { true: 'Asks for immediate action', false: undefined });
	});

	it('rejects an empty question list', () => {
		expect(() => buildQuestions([])).toThrow('at least one question');
	});

	it('rejects a question with no name', () => {
		expect(() => buildQuestions([{ name: '  ', type: 'noul' }])).toThrow('needs a name');
	});

	it('rejects duplicate question names', () => {
		expect(() => buildQuestions([choiceRow, choiceRow])).toThrow('used more than once');
	});

	it('rejects a choice option with no label', () => {
		expect(() =>
			buildQuestions([
				{ name: 'a', type: 'choice', choiceCriteria: { values: [{ label: '' }, { label: 'b' }] } },
			]),
		).toThrow('an option with no label');
	});

	it('rejects a repeated choice label', () => {
		expect(() =>
			buildQuestions([
				{ name: 'a', type: 'choice', choiceCriteria: { values: [{ label: 'x' }, { label: 'x' }] } },
			]),
		).toThrow('repeats the label "x"');
	});

	it('applies the shared schema rules to built questions', () => {
		expect(() => buildQuestions([{ name: 'anger', type: 'score', scoreCriteria: ['Calm'] }])).toThrow(
			'at least two rubric levels',
		);
	});
});
