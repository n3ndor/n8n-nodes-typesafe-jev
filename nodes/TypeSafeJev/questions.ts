/* eslint-disable @n8n/community-nodes/require-node-api-error -- This module is deliberately free of n8n imports so the schema rules can be unit tested without a node context. QuestionSchemaError is converted into a NodeOperationError at the single boundary in TypeSafeJev.node.ts, which is what the user actually sees. */
import { QUESTION_TYPES, type EntryType, type Question, type Questions } from './types';

/**
 * Raised when the configured question schema is invalid.
 *
 * This module stays free of n8n imports so it can be unit tested on its own;
 * `TypeSafeJev.node.ts` converts these into `NodeOperationError` at the boundary.
 */
export class QuestionSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QuestionSchemaError';
	}
}

/**
 * n8n `json` parameters hand back a **string** whenever the user types literal
 * JSON into the field, and the parsed value only when the field holds an
 * expression that resolved to one. Every JSON-typed parameter must go through
 * here before it is inspected or sent.
 */
export function parseJsonParameter(value: unknown, fieldName: string): unknown {
	if (typeof value !== 'string') return value;

	const trimmed = value.trim();
	if (trimmed === '') return undefined;

	try {
		return JSON.parse(trimmed);
	} catch {
		throw new QuestionSchemaError(`${fieldName} is not valid JSON.`);
	}
}

/**
 * State may legitimately be plain prose, so a parse failure is not an error:
 * fall back to the raw string, which the API accepts.
 */
export function parseState(value: unknown): EntryType {
	if (typeof value !== 'string') return value as EntryType;

	const trimmed = value.trim();
	if (trimmed === '') return '';
	if (!/^[[{]/.test(trimmed)) return value;

	try {
		return JSON.parse(trimmed) as EntryType;
	} catch {
		return value;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a questions schema before spending an API call on it. */
export function validateQuestions(value: unknown): Questions {
	if (!isPlainObject(value) || Object.keys(value).length === 0) {
		throw new QuestionSchemaError('Questions must be a non-empty JSON object keyed by question name.');
	}

	for (const [name, question] of Object.entries(value)) {
		if (!name.trim() || !isPlainObject(question)) {
			throw new QuestionSchemaError('Each question needs a non-empty name and an object value.');
		}

		const type = String(question.type);
		if (!(QUESTION_TYPES as readonly string[]).includes(type)) {
			throw new QuestionSchemaError(
				`Question "${name}" has type "${type}". Expected one of: ${QUESTION_TYPES.join(', ')}.`,
			);
		}

		if (type === 'choice') {
			if (!isPlainObject(question.criteria) || Object.keys(question.criteria).length < 2) {
				throw new QuestionSchemaError(`Choice question "${name}" needs at least two criteria labels.`);
			}
		}

		if (type === 'score') {
			if (!Array.isArray(question.criteria) || question.criteria.length < 2) {
				throw new QuestionSchemaError(
					`Score question "${name}" needs a criteria array with at least two rubric levels.`,
				);
			}
		}

		if (type === 'noul') {
			const { criteria } = question;
			if (criteria !== undefined && criteria !== null && !isPlainObject(criteria)) {
				throw new QuestionSchemaError(`Yes/No question "${name}" criteria must be an object when supplied.`);
			}
		}
	}

	return value as Questions;
}

/** One row of the Question Builder fixed collection. */
export interface QuestionBuilderRow {
	name?: string;
	type?: string;
	instructions?: string;
	choiceCriteria?: { values?: Array<{ label?: string; description?: string }> };
	scoreCriteria?: string[];
	noulTrue?: string;
	noulFalse?: string;
}

function optionalText(value: string | undefined): EntryType | undefined {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? undefined : trimmed;
}

/** Turn Question Builder rows into the wire schema. */
export function buildQuestions(rows: QuestionBuilderRow[]): Questions {
	if (rows.length === 0) {
		throw new QuestionSchemaError('Add at least one question.');
	}

	const questions: Questions = {};

	for (const row of rows) {
		const name = (row.name ?? '').trim();
		if (!name) throw new QuestionSchemaError('Every question needs a name.');
		if (questions[name]) throw new QuestionSchemaError(`Question name "${name}" is used more than once.`);

		const instructions = optionalText(row.instructions);

		if (row.type === 'choice') {
			const criteria: Record<string, EntryType> = {};
			for (const entry of row.choiceCriteria?.values ?? []) {
				const label = (entry.label ?? '').trim();
				if (!label) throw new QuestionSchemaError(`Choice question "${name}" has an option with no label.`);
				if (label in criteria) {
					throw new QuestionSchemaError(`Choice question "${name}" repeats the label "${label}".`);
				}
				criteria[label] = optionalText(entry.description) ?? null;
			}
			questions[name] = { type: 'choice', instructions, criteria };
			continue;
		}

		if (row.type === 'score') {
			const criteria = (row.scoreCriteria ?? []).map((level) => optionalText(level) ?? null);
			questions[name] = {
				type: 'score',
				instructions,
				criteria: criteria as [EntryType, EntryType, ...EntryType[]],
			};
			continue;
		}

		if (row.type === 'noul') {
			const trueText = optionalText(row.noulTrue);
			const falseText = optionalText(row.noulFalse);
			const question: Question = { type: 'noul', instructions };
			if (trueText !== undefined || falseText !== undefined) {
				question.criteria = { true: trueText, false: falseText };
			}
			questions[name] = question;
			continue;
		}

		throw new QuestionSchemaError(
			`Question "${name}" has type "${row.type}". Expected one of: ${QUESTION_TYPES.join(', ')}.`,
		);
	}

	return validateQuestions(questions);
}
