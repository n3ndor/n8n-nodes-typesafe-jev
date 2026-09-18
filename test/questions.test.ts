import { describe, expect, it } from 'vitest';

import { validateQuestions } from '../nodes/TypeSafeJev/TypeSafeJev.node';

describe('validateQuestions', () => {
	it('accepts every Jev question type', () => {
		expect(validateQuestions({
			intent: { type: 'choice', criteria: { billing: 'Billing issue', other: null } },
			urgent: { type: 'noul', instructions: 'Is this urgent?' },
			severity: { type: 'score', criteria: ['Low', 'High'] },
		})).toHaveProperty('intent.type', 'choice');
	});

	it('rejects malformed score rubrics before an API call', () => {
		expect(() => validateQuestions({ severity: { type: 'score', criteria: ['Only one'] } }))
			.toThrow('at least two rubric levels');
	});
});
