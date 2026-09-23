import {
	NodeApiError,
	sleep,
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

/**
 * Statuses TypeSafe asks callers to back off on. Everything else is final: retrying a
 * 401 or a 422 only burns the rate limit the node is trying to stay inside.
 */
const RETRYABLE_STATUS = new Set([429, 529]);

/**
 * Transport failures worth retrying. These never carry a status, because the helper
 * throws rather than answering when the socket times out or drops.
 */
const RETRYABLE_ERROR_PATTERNS = [
	'etimedout',
	'esockettimedout',
	'econnreset',
	'econnrefused',
	'epipe',
	'eai_again',
	'enotfound',
	'socket hang up',
	'timeout',
	'timed out',
];

/**
 * Ceilings on backing off. retry-after is a hint from the API or from any proxy in
 * between, so it is honoured but bounded: one header should not be able to hold an n8n
 * worker for as long as it likes. The budget covers the whole sequence for one item and
 * is checked before sleeping, so the node gives up rather than starting a wait it cannot
 * finish inside it.
 */
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 15_000;
const RETRY_BUDGET_MS = 30_000;

/** Whether a thrown request failure is a transport problem rather than a rejection. */
function isTransportFailure(error: unknown): boolean {
	const failure = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
	const parts = [failure?.code, failure?.cause?.code, failure?.message]
		.filter((part) => part !== undefined && part !== null)
		.map((part) => String(part).toLowerCase());

	return parts.some((part) => RETRYABLE_ERROR_PATTERNS.some((pattern) => part.includes(pattern)));
}

/** Seconds from a retry-after header, when it carries one. */
function readRetryAfterMs(error: HttpFailure): number | undefined {
	const seconds = Number(readHeader(responseOf(error)?.headers, 'retry-after'));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

interface FullResponse {
	body: unknown;
	headers: Record<string, string | string[] | undefined>;
	statusCode: number;
}

interface FailureResponse {
	status?: number;
	statusCode?: number;
	body?: unknown;
	data?: unknown;
	headers?: Record<string, string | string[] | undefined>;
}

/**
 * Shape n8n's HTTP helpers attach to a failed request.
 *
 * Verified against n8n 2.39.8: `httpRequestWithAuthentication` does not throw
 * the axios error, it throws a NodeApiError that carries `httpCode` and keeps
 * the axios error on `cause`. The real response, with the server's body under
 * `data`, therefore lives at `error.cause.response`, not `error.response`.
 * Both are read so a change in either direction keeps working.
 */
interface HttpFailure {
	statusCode?: number;
	httpCode?: string | number;
	message?: string;
	errorResponse?: unknown;
	response?: FailureResponse;
	cause?: { response?: FailureResponse };
}

function responseOf(error: HttpFailure): FailureResponse | undefined {
	return error.response ?? error.cause?.response;
}

function readStatus(error: HttpFailure): number | undefined {
	const response = responseOf(error);
	const candidates = [error.statusCode, response?.status, response?.statusCode];
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
	const response = responseOf(failure);
	const requestId = readHeader(response?.headers, REQUEST_ID_HEADER);

	// axios puts the parsed body on `data`; n8n's own helpers use `body`.
	const serverMessage =
		readErrorMessage(response?.body) ??
		readErrorMessage(response?.data) ??
		readErrorMessage(failure.errorResponse);

	const parts: string[] = [];
	// The server's message usually ends in a period; do not add a second one.
	if (serverMessage) parts.push(serverMessage.trim().replace(/\.\s*$/, ''));
	if (requestId) parts.push(`TypeSafe request ID: ${requestId}`);
	const description = parts.join('. ');

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
			'User-Agent': '@n3ndor/n8n-nodes-typesafe-jev',
		},
	};

	let budgetMs = RETRY_BUDGET_MS;

	for (let attempt = 1; ; attempt++) {
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
			const status = readStatus(error as HttpFailure);
			const retryable =
				status === undefined ? isTransportFailure(error) : RETRYABLE_STATUS.has(status);

			if (!retryable || attempt >= MAX_ATTEMPTS) {
				throw toApiError(context, error, options.itemIndex);
			}

			const requested = readRetryAfterMs(error as HttpFailure) ?? 2 ** (attempt - 1) * 500;
			const waitMs = Math.min(requested, MAX_RETRY_WAIT_MS, budgetMs);
			if (waitMs <= 0) throw toApiError(context, error, options.itemIndex);

			budgetMs -= waitMs;
			await sleep(waitMs);
		}
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
