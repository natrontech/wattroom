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

const NOT_DATA: ApiError = {
	error: 'internal_error',
	message:
		'The server answered with a page instead of data — reload and try again.',
};
const NETWORK: ApiError = {
	error: 'network',
	message: 'The server is not reachable.',
};

/**
 * What every caller here may pass. A **string** body is deliberately not one
 * of them (#2163): fetch stamps it text/plain, and httpx.DecodeStrict refuses
 * any form-encodable type outright — that is the CSRF fence, not a quirk — so
 * the request 400s and the screen reports a refusal that looks like the
 * server's own. One caller sent JSON that way and neither of its switches had
 * ever saved. `json` is the way to send an object, and now it is the only way.
 *
 * A Blob or a File still passes: the picture and track uploads send bytes with
 * a content type of their own, which is a different thing entirely.
 */
type ApiInit = Omit<RequestInit, 'body'> & {
	body?: Exclude<BodyInit, string> | null;
	json?: unknown;
};

// Internal, like `request`: it takes whatever the Fetcher signature hands it.
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
	// The last hop before fetch, and the one place a string body is right:
	// `loadApi` below builds one WITH the content type. The fence is on the
	// public functions, which is where the mistake is made.
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
	try {
		const res = await fetcher(path, init);
		if (res.status === 204) return { ok: true, data: undefined as T };
		if (!res.ok) return failure(res);
		// The shell with a 200 is not data (#1604): an unmounted route used
		// to come back as {ok, data: null} and the caller dereferenced it. A
		// body that parses is data whatever its header says — test fakes are
		// not always typed — and HTML never parses.
		const data = await res.json().catch(() => undefined);
		if (
			data === undefined &&
			(res.headers.get('content-type') ?? '').includes('text/html')
		)
			return { ok: false, error: NOT_DATA };
		return { ok: true, data: (data ?? null) as T };
	} catch {
		return { ok: false, error: NETWORK };
	}
}

export async function api<T>(
	path: string,
	init?: ApiInit,
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
	init?: ApiInit,
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
	init?: ApiInit,
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
