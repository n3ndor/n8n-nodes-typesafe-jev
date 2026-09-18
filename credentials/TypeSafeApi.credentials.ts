import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TypeSafeApi implements ICredentialType {
	name = 'typeSafeApi';

	icon = { light: 'file:../nodes/TypeSafeJev/typesafeJev.svg', dark: 'file:../nodes/TypeSafeJev/typesafeJev.dark.svg' } as const;

	displayName = 'TypeSafe API';

	documentationUrl = 'https://docs.typesafe.ai';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your TypeSafe API key, created in the TypeSafe console',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.typesafe.ai',
			description:
				'API root. Change this only when pointing at a proxy or a dedicated TypeSafe deployment.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://api.typesafe.ai"}}',
			url: '/v1/models',
			method: 'GET',
		},
	};
}
