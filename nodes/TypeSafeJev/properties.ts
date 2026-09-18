import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_MODEL } from './transport';

/**
 * Note: entries inside `fixedCollection` value lists are ordered alphabetically
 * by `displayName` to satisfy n8n's linter, not for readability. Do not run
 * `n8n-node lint --fix` over this file. Its autofixer reorders these entries by
 * rebuilding them and silently drops `displayOptions` and `typeOptions`, which
 * collapses the per-type question form into a flat one.
 */
export const typeSafeJevProperties: INodeProperties[] = [
	{
		displayName: 'Model Name or ID',
		name: 'model',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getModels' },
		default: DEFAULT_MODEL,
		description:
			'The TypeSafe model that answers the questions. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'State',
		name: 'state',
		type: 'json',
		default: '={{ $json }}',
		required: true,
		description:
			'The information Jev should assess. Plain text, a JSON object or a JSON array. Defaults to the whole incoming item.',
	},
	{
		displayName: 'Question Input',
		name: 'questionInput',
		type: 'options',
		noDataExpression: true,
		default: 'builder',
		options: [
			{
				name: 'JSON',
				value: 'json',
				description: 'Supply the complete questions schema, so it can be generated upstream',
			},
			{
				name: 'Question Builder',
				value: 'builder',
				description: 'Define questions field by field',
			},
		],
		description: 'How the questions are defined',
	},

	// --- Question Builder ------------------------------------------------------
	{
		displayName: 'Questions',
		name: 'questions',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		placeholder: 'Add Question',
		displayOptions: { show: { questionInput: ['builder'] } },
		options: [
			{
				name: 'questionValues',
				displayName: 'Question',
				values: [
					{
						displayName: 'Describe No',
						name: 'noulFalse',
						type: 'string',
						default: '',
						displayOptions: { show: { type: ['noul'] } },
						placeholder: 'e.g. They do not convey time pressure',
						description: 'Optional description of what counts as no',
					},
					{
						displayName: 'Describe Yes',
						name: 'noulTrue',
						type: 'string',
						default: '',
						displayOptions: { show: { type: ['noul'] } },
						placeholder: 'e.g. They ask for immediate or time-bound action',
						description: 'Optional description of what counts as yes',
					},
					{
						displayName: 'Instructions',
						name: 'instructions',
						type: 'string',
						default: '',
						typeOptions: { rows: 2 },
						placeholder: 'e.g. What is the primary request?',
						description: 'The question put to Jev',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'e.g. intent',
						description: 'Key this answer appears under in the output. Must be unique.',
					},
					{
						displayName: 'Options',
						name: 'choiceCriteria',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true, sortable: true },
						default: {},
						placeholder: 'Add Option',
						displayOptions: { show: { type: ['choice'] } },
						description: 'The labels Jev chooses between. At least two are required.',
						options: [
							{
								name: 'values',
								displayName: 'Option',
								values: [
									{
										displayName: 'Description',
										name: 'description',
										type: 'string',
										default: '',
										placeholder: 'e.g. The customer requests money returned',
										description:
											'What this option means. Leave empty to let the label speak for itself.',
									},
									{
										displayName: 'Label',
										name: 'label',
										type: 'string',
										default: '',
										required: true,
										placeholder: 'e.g. refund',
										description: 'The value returned when Jev picks this option',
									},
								],
							},
						],
					},
					{
						displayName: 'Rubric Levels',
						name: 'scoreCriteria',
						type: 'string',
						typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Level', rows: 2 },
						default: [],
						displayOptions: { show: { type: ['score'] } },
						description:
							'Ordered rubric, lowest first. Level 0 is the first entry. At least two are required.',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'choice',
						noDataExpression: true,
						options: [
							{
								name: 'Choice',
								value: 'choice',
								description: 'Pick one of several named options',
							},
							{
								name: 'Score',
								value: 'score',
								description: 'Return an expected score over an ordered rubric',
							},
							{
								name: 'Yes/No',
								value: 'noul',
								description: 'Return the probability that the answer is yes',
							},
						],
						description: 'The kind of decision Jev should return',
					},
				],
			},
		],
	},

	// --- JSON mode -------------------------------------------------------------
	{
		displayName: 'Questions (JSON)',
		name: 'questionsJson',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: { show: { questionInput: ['json'] } },
		description:
			'Questions keyed by name. Each value needs a type of choice, noul or score, optional instructions, and criteria.',
	},

	// --- Output ----------------------------------------------------------------
	{
		displayName: 'Output',
		name: 'output',
		type: 'options',
		noDataExpression: true,
		default: 'append',
		options: [
			{
				name: 'Answers Only',
				value: 'answersOnly',
				description: 'Output just the answers, without model or usage metadata',
			},
			{
				name: 'Append to Item',
				value: 'append',
				description: 'Keep the incoming fields and add the full response alongside them',
			},
			{
				name: 'Response Only',
				value: 'responseOnly',
				description: 'Replace the item with the full TypeSafe response',
			},
		],
		description: 'What the node emits for each item',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: false,
		description:
			'Whether to reduce each answer to its primary value (the chosen label, the yes probability, or the expected score) instead of the full object',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Include Request ID',
				name: 'includeRequestId',
				type: 'boolean',
				default: false,
				description:
					'Whether to include the TypeSafe request ID in the output. Useful when reporting a problem to TypeSafe support.',
			},
			{
				displayName: 'Output Field Name',
				name: 'outputField',
				type: 'string',
				default: 'typesafeJev',
				description: 'Field the response is written to when Output is set to append',
			},
			{
				displayName: 'Timeout (Ms)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 1000 },
				default: 60000,
				description: 'How long to wait for a response before failing the request',
			},
		],
	},
];
