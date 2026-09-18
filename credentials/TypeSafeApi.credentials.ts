import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class TypeSafeApi implements ICredentialType {

	name = 'typeSafeApi';

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
			description: 'TypeSafe API key. Keep this key server-side and never expose it in workflow data.',
		},
	];
}
