/**
 * Wire types for the TypeSafe API, mirrored locally.
 *
 * Verified community nodes may not ship runtime dependencies, so we cannot use
 * `@typesafe-ai/sdk`. These declarations track the shapes documented for
 * `POST /v1/systemone` and `GET /v1/models` in `@typesafe-ai/sdk@0.6.0`.
 */

/** A JSON-compatible value. */
export type JsonValue =
	string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Text, a JSON object or array, or `null` for state, instructions and criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

/** A yes/no question with optional descriptions for either outcome. */
export interface NoulQuestion {
	type: 'noul';
	instructions?: EntryType;
	criteria?: { true?: EntryType; false?: EntryType } | null;
}

/** Labels mapped to descriptions; `null` leaves a label undescribed. */
export type ChoiceCriteria = { [label: string]: EntryType };

/** A question that selects between named alternatives. */
export interface ChoiceQuestion {
	type: 'choice';
	instructions?: EntryType;
	criteria: ChoiceCriteria;
}

/** At least two rubric descriptions, indexed by score from zero. */
export type ScoreCriteria = [EntryType, EntryType, ...EntryType[]];

/** A question that assigns a score using an ordered rubric. */
export interface ScoreQuestion {
	type: 'score';
	instructions?: EntryType;
	criteria: ScoreCriteria;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Questions keyed by the names used to identify their answers. */
export type Questions = Record<string, Question>;

export const QUESTION_TYPES = ['choice', 'noul', 'score'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface NoulAnswer {
	type: 'noul';
	/** Probability of a yes answer, from zero to one. */
	noul: number;
}

export interface ChoiceAnswer {
	type: 'choice';
	choice: string;
	confidence: number;
	probabilities: Record<string, number>;
}

export interface ScoreAnswer {
	type: 'score';
	/** Expected score, which may fall between integer rubric levels. */
	score: number;
	confidence: number;
	legend: Record<string, EntryType>;
	probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface Usage {
	input_tokens: number;
	output_tokens: number;
}

/** Response body of `POST /v1/systemone`. */
export interface SystemOneResult {
	model: string;
	answers: Record<string, Answer>;
	usage: Usage;
}

/** Request body of `POST /v1/systemone`. */
export interface SystemOneRequest {
	state: EntryType;
	questions: Questions;
	model?: string;
}

/** An entry of `GET /v1/models`. */
export interface ModelCard {
	name: string;
	description: string;
	release_date: string;
}

/** Response body of `GET /v1/models`, as the live API returns it. */
export interface ModelsResponse {
	models: ModelCard[];
}
