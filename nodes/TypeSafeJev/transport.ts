import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type JsonObject,
} from 'n8n-workflow';

import type { ModelCard, ModelsResponse, SystemOneRequest, SystemOneResult } from './types';

export const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_MODEL = 'jev-latest';
export const CREDENTIAL_NAME = 'typeSafeApi';

/** Header TypeSafe returns on every response; quote it when reporting a failure. */
const REQUEST_ID_HEADER = 'x-typesafe-request-id';

interface FullResponse {
	body: unknown;
	headers: Record<string, string | string[] | undefined>;
	statusCode: number;
}

/** Shape n8n's HTTP helpers attach to a failed request, across transports. */
interface HttpFailure {
	statusCode?: number;
	httpCode?: string;
	message?: string;
	response?: {
		status?: number;
		statusCode?: number;
		body?: unknown;
		headers?: Record<string, string | string[] | undefined>;
	};
}

function readStatus(error: HttpFailure): number | undefined {
	const candidates = [error.statusCode, error.response?.status, error.response?.statusCode];
	for (const candidate of candidates) {
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
	}
	const parsed = Number(error.httpCode);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readHeader(
	headers: Record<string, string | string[] | undefined> | undefined,
	name: string,
): string | undefined {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value[0];
	return undefined;
}

/**
 * Pull the server's own explanation out of an error body.
 *
 * Verified against the live API: a rejected request answers with
 * `{ detail: { error_type, message } }`. The other shapes are accepted because
 * the SDK's own types describe them and the wire format may still vary.
 */
function readErrorMessage(body: unknown): string | undefined {
	if (typeof body === 'string') return body.trim() === '' ? undefined : body;
	if (typeof body !== 'object' || body === null) return undefined;

	const b = body as {
		detail?: string | { message?: string; error_type?: string };
		error?: string | { message?: string };
		message?: string;
	};

	if (typeof b.detail === 'string') return b.detail;
	if (typeof b.detail?.message === 'string') return b.detail.message;
	if (typeof b.error === 'string') return b.error;
	if (typeof b.error?.message === 'string') return b.error.message;
	if (typeof b.message === 'string') return b.message;
	return undefined;
}

/**
 * Turn a failed request into a NodeApiError that keeps what a user needs to act
 * on: the status, the server's own message, and the request ID to quote to
 * TypeSafe support.
 */
function toApiError(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	error: unknown,
	itemIndex?: number,
): NodeApiError {
	const failure = error as HttpFailure;
	const status = readStatus(failure);
	const requestId = readHeader(failure.response?.headers, REQUEST_ID_HEADER);

	const description = [readErrorMessage(failure.response?.body), requestId ? `TypeSafe request ID: ${requestId}` : undefined]
		.filter(Boolean)
		.join('. ');

	return new NodeApiError(context.getNode(), error as JsonObject, {
		message: status ? `TypeSafe API returned ${status}` : 'TypeSafe API request failed',
		description: description === '' ? undefined : description,
		httpCode: status === undefined ? undefined : String(status),
		itemIndex,
	});
}

async function request<T>(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; timeout?: number; itemIndex?: number } = {},
): Promise<{ data: T; requestId?: string }> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const baseUrl = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).replace(/\/+$/, '');

	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		body: options.body,
		json: true,
		timeout: options.timeout,
		returnFullResponse: true,
		headers: {
			Accept: 'application/json',
			'User-Agent': 'n8n-nodes-typesafe-jev',
		},
	};

	try {
		const response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_NAME,
			requestOptions,
		)) as FullResponse;

		return {
			data: response.body as T,
			requestId: readHeader(response.headers, REQUEST_ID_HEADER),
		};
	} catch (error) {
		throw toApiError(context, error, options.itemIndex);
	}
}

/** Answer named questions about state. */
export async function systemOne(
	context: IExecuteFunctions,
	payload: SystemOneRequest,
	options: { timeout?: number; itemIndex?: number } = {},
): Promise<{ data: SystemOneResult; requestId?: string }> {
	return await request<SystemOneResult>(context, 'POST', '/v1/systemone', {
		body: payload as unknown as IDataObject,
		timeout: options.timeout,
		itemIndex: options.itemIndex,
	});
}

/**
 * List the models available to the account.
 *
 * The live API answers `{ models: [...] }`. A bare array is still accepted,
 * because that is what the SDK's own types describe.
 */
export async function listModels(context: ILoadOptionsFunctions): Promise<ModelCard[]> {
	const { data } = await request<ModelCard[] | ModelsResponse>(context, 'GET', '/v1/models');
	if (Array.isArray(data)) return data;
	const models = (data as ModelsResponse)?.models;
	return Array.isArray(models) ? models : [];
}
