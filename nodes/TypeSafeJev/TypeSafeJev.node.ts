import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { typeSafeJevProperties } from './properties';
import {
	buildQuestions,
	parseJsonParameter,
	parseState,
	validateQuestions,
	type QuestionBuilderRow,
} from './questions';
import { CREDENTIAL_NAME, listModels, systemOne } from './transport';
import type { Answer, Questions } from './types';

/**
 * Programmatic rather than declarative: the questions schema is assembled from a
 * nested fixed collection and validated before the call, which routing-based
 * declarative nodes cannot express.
 */

/** Collapse an answer to the single value most workflows branch on. */
function simplifyAnswer(answer: Answer): string | number {
	switch (answer.type) {
		case 'choice':
			return answer.choice;
		case 'noul':
			return answer.noul;
		case 'score':
			return answer.score;
		default:
			return (answer as { type: string }).type;
	}
}

function simplifyAnswers(answers: Record<string, Answer>): IDataObject {
	const simplified: IDataObject = {};
	for (const [name, answer] of Object.entries(answers)) {
		simplified[name] = simplifyAnswer(answer);
	}
	return simplified;
}

export class TypeSafeJev implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TypeSafe Jev',
		name: 'typeSafeJev',
		icon: { light: 'file:typesafeJev.svg', dark: 'file:typesafeJev.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["model"] }}',
		description: 'Make typed, calibrated decisions with TypeSafe Jev',
		defaults: { name: 'TypeSafe Jev' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_NAME, required: true }],
		properties: typeSafeJevProperties,
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const models = await listModels(this);
				return models.map((model) => ({
					name: model.name,
					value: model.name,
					description: model.description,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const model = this.getNodeParameter('model', itemIndex) as string;
				const state = parseState(this.getNodeParameter('state', itemIndex));
				const questionInput = this.getNodeParameter('questionInput', itemIndex) as string;
				const output = this.getNodeParameter('output', itemIndex) as string;
				const simplify = this.getNodeParameter('simplify', itemIndex) as boolean;
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					includeRequestId?: boolean;
					outputField?: string;
					timeout?: number;
				};

				let questions: Questions;
				try {
					questions =
						questionInput === 'json'
							? validateQuestions(
									parseJsonParameter(
										this.getNodeParameter('questionsJson', itemIndex),
										'Questions (JSON)',
									),
								)
							: buildQuestions(
									(
										this.getNodeParameter('questions', itemIndex, {}) as {
											questionValues?: QuestionBuilderRow[];
										}
									).questionValues ?? [],
								);
				} catch (error) {
					// A bad schema is the user's configuration, not an API failure.
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				}

				const { data, requestId } = await systemOne(
					this,
					{ model, state, questions },
					{ timeout: options.timeout, itemIndex },
				);

				const answers = simplify
					? simplifyAnswers(data.answers)
					: (data.answers as unknown as IDataObject);

				let payload: IDataObject;
				if (output === 'answersOnly') {
					payload = answers;
				} else {
					payload = { model: data.model, answers, usage: data.usage as unknown as IDataObject };
				}

				if (options.includeRequestId && requestId) {
					payload = { ...payload, requestId };
				}

				const json: IDataObject =
					output === 'append'
						? { ...items[itemIndex].json, [options.outputField ?? 'typesafeJev']: payload }
						: payload;

				returnData.push({ json, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { ...items[itemIndex].json, error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// `systemOne` and the schema guard above already raise n8n errors;
				// anything else reaching here is an operational fault.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
