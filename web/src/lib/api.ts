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

export async function api<T>(
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
	try {
		const { json, ...rest } = init ?? {};
		const res = await fetch(path, {
			...rest,
			...(json !== undefined && {
				headers: { 'content-type': 'application/json', ...rest.headers },
				body: JSON.stringify(json),
			}),
		});
		if (res.status === 204) return { ok: true, data: undefined as T };
		const body = await res.json().catch(() => null);
		if (res.ok) return { ok: true, data: body as T };
		return {
			ok: false,
			error: body?.message
				? (body as ApiError)
				: {
						error: 'internal_error',
						message: 'The server did not answer properly.',
					},
		};
	} catch {
		return {
			ok: false,
			error: { error: 'network', message: 'The server is not reachable.' },
		};
	}
}
