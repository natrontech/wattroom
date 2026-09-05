/**
 * The one fetch wrapper (.claude/rules/code-quality.md: one shared client, no
 * scattered boilerplate). Returns data or the errors.md shape — never throws
 * on HTTP status, so callers handle failure as a value.
 */
export interface ApiError {
	error: string;
	message: string;
	field?: string;
}

export type ApiResult<T> =
	{ ok: true; data: T } | { ok: false; error: ApiError };

const NETWORK: ApiError = {
	error: 'network',
	message: 'The server is not reachable.',
};

function send(path: string, init?: RequestInit & { json?: unknown }) {
	const { json, ...rest } = init ?? {};
	return fetch(path, {
		...rest,
		...(json !== undefined && {
			headers: { 'content-type': 'application/json', ...rest.headers },
			body: JSON.stringify(json),
		}),
	});
}

type Fetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

async function failure(res: Response): Promise<{ ok: false; error: ApiError }> {
	const body = await res.json().catch(() => null);
	return {
		ok: false,
		error: body?.message
			? (body as ApiError)
			: {
					error: 'internal_error',
					message: 'The server did not answer properly.',
				},
	};
}

async function request<T>(
	fetcher: Fetcher,
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
	try {
		const res = await fetcher(path, init);
		if (res.status === 204) return { ok: true, data: undefined as T };
		if (!res.ok) return failure(res);
		return { ok: true, data: (await res.json().catch(() => null)) as T };
	} catch {
		return { ok: false, error: NETWORK };
	}
}

export async function api<T>(
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
	return request<T>(
		(input, requestInit) => send(String(input), requestInit),
		path,
		init,
	);
}

/** Use SvelteKit's navigation-aware fetch from a route load function. */
export async function loadApi<T>(
	fetcher: Fetcher,
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
	const { json, ...rest } = init ?? {};
	return request<T>(
		fetcher,
		path,
		json === undefined
			? rest
			: {
					...rest,
					headers: { 'content-type': 'application/json', ...rest.headers },
					body: JSON.stringify(json),
				},
	);
}

/** Same contract for binary responses (.fit exports) — api() assumes JSON. */
export async function apiBlob(
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<{ blob: Blob; filename?: string }>> {
	try {
		const res = await send(path, init);
		if (!res.ok) return failure(res);
		return {
			ok: true,
			data: {
				blob: await res.blob(),
				filename: res.headers
					.get('content-disposition')
					?.match(/filename="(.+)"/)?.[1],
			},
		};
	} catch {
		return { ok: false, error: NETWORK };
	}
}
