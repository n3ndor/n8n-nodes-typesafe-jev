import { TypeSafeClient } from '@typesafe-ai/sdk';
import {
	NodeApiError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

type QuestionType = 'choice' | 'noul' | 'score';

interface BuiltQuestion {
	type: QuestionType;
	instructions?: unknown;
	criteria?: unknown;
}

function parseJson(value: unknown, fieldName: string): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${fieldName} must be valid JSON.`);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the dynamic question schema before sending it to the provider. */
export function validateQuestions(value: unknown): Record<string, BuiltQuestion> {
	if (!isPlainObject(value) || Object.keys(value).length === 0) {
		throw new Error('Questions must be a non-empty JSON object keyed by question name.');
	}

	for (const [name, question] of Object.entries(value)) {
		if (!name.trim() || !isPlainObject(question)) {
			throw new Error('Each question needs a non-empty name and an object value.');
		}
		if (!['choice', 'noul', 'score'].includes(String(question.type))) {
			throw new Error(`Question "${name}" must have type choice, noul, or score.`);
		}
		if (question.type === 'choice' && (!isPlainObject(question.criteria) || Object.keys(question.criteria).length < 2)) {
			throw new Error(`Choice question "${name}" needs at least two criteria labels.`);
		}
		if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
			throw new Error(`Score question "${name}" needs a criteria array with at least two rubric levels.`);
		}
		if (question.type === 'noul' && question.criteria !== undefined && question.criteria !== null && !isPlainObject(question.criteria)) {
			throw new Error(`Noul question "${name}" criteria must be an object when supplied.`);
		}
	}

	return value as Record<string, BuiltQuestion>;
}

function buildQuestions(questionValues: Array<Record<string, unknown>>): Record<string, BuiltQuestion> {
	const questions: Record<string, BuiltQuestion> = {};
	for (const question of questionValues) {
		const name = String(question.name ?? '').trim();
		if (!name) throw new Error('Every question needs a unique question name.');
		if (questions[name]) throw new Error(`Question name "${name}" is duplicated.`);
		const type = question.type as QuestionType;
		questions[name] = {
			type,
			instructions: question.instructions || undefined,
			criteria: parseJson(question.criteria, `Criteria for "${name}"`),
		};
	}
	return validateQuestions(questions);
}

export class TypeSafeJev implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TypeSafe Jev',
		name: 'typeSafeJev',
		icon: 'file:typesafeJev.svg',
		group: ['transform'],
		version: 1,
		description: 'Make typed, calibrated decisions with TypeSafe Jev System One',
		defaults: { name: 'TypeSafe Jev' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'typeSafeApi', required: true }],
		properties: [
			{
				displayName: 'Model', name: 'model', type: 'string', default: 'jev-latest',
				description: 'The TypeSafe model identifier',
			},
			{
				displayName: 'State', name: 'state', type: 'json', default: '={{ $json }}', required: true,
				description: 'Text, JSON object, JSON array, or expression containing the information Jev should assess',
			},
			{
				displayName: 'Question Input', name: 'questionInput', type: 'options', default: 'builder',
				options: [
					{ name: 'Question Builder', value: 'builder' },
					{ name: 'JSON', value: 'json' },
				],
				description: 'Choose a guided builder or supply the complete questions schema as JSON',
			},
			{
				displayName: 'Questions', name: 'questions', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {},
				displayOptions: { show: { questionInput: ['builder'] } },
				options: [{
					name: 'questionValues', displayName: 'Question', values: [
						{ displayName: 'Name', name: 'name', type: 'string', default: '', required: true, description: 'Stable key used in the response answers object' },
						{ displayName: 'Type', name: 'type', type: 'options', default: 'choice', options: [
							{ name: 'Choice', value: 'choice', description: 'Choose one named option' },
							{ name: 'Yes / No (Noul)', value: 'noul', description: 'Return the probability of yes' },
							{ name: 'Score', value: 'score', description: 'Return an expected score over an ordered rubric' },
						] },
						{ displayName: 'Instructions', name: 'instructions', type: 'string', default: '', typeOptions: { rows: 3 }, description: 'Question given to Jev. Supports expressions.' },
						{ displayName: 'Criteria (JSON)', name: 'criteria', type: 'json', default: '{}', required: true, description: 'Choice: object of label to description; Noul: optional true/false object; Score: array of ordered rubric descriptions. Supports expressions.' },
					],
				}],
			},
			{
				displayName: 'Questions (JSON)', name: 'questionsJson', type: 'json', default: '{}', required: true,
				displayOptions: { show: { questionInput: ['json'] } },
				description: 'Questions keyed by name. Each value needs type, optional instructions, and criteria. Supports expressions.',
			},
			{
				displayName: 'Output', name: 'output', type: 'options', default: 'append',
				options: [
					{ name: 'Append Result', value: 'append', description: 'Keep input fields and add typesafeJev' },
					{ name: 'Result Only', value: 'resultOnly', description: 'Output only the TypeSafe response' },
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('typeSafeApi');
		const apiKey = credentials.apiKey as string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const model = this.getNodeParameter('model', itemIndex) as string;
				const state = this.getNodeParameter('state', itemIndex);
				const questionInput = this.getNodeParameter('questionInput', itemIndex) as string;
				const questions = questionInput === 'json'
					? validateQuestions(this.getNodeParameter('questionsJson', itemIndex))
					: buildQuestions(((this.getNodeParameter('questions', itemIndex) as { questionValues?: Array<Record<string, unknown>> }).questionValues) ?? []);

				const client = new TypeSafeClient({ apiKey });
				const result = await client.systemOne({ model, state: state as never, questions: questions as never } as never);
				const output = this.getNodeParameter('output', itemIndex) as string;
				returnData.push({
					json: (output === 'resultOnly' ? result : { ...items[itemIndex].json, typesafeJev: result }) as unknown as JsonObject,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { ...items[itemIndex].json, error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}
		return [returnData];
	}
}
