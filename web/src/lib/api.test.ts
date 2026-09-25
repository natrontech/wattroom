import { describe, expect, it } from 'vitest';
import { loadApi } from './api';

// A route's load() holds the page until its read answers, so a read that
// hangs held it for ever (#2845). loadApi bounds it, and a caller's own
// signal still wins.
describe('loadApi bounds a route read', () => {
	it('gives the read a signal, and keeps the caller’s own', async () => {
		const seen: (AbortSignal | null | undefined)[] = [];
		const fetcher = async (_: RequestInfo | URL, init?: RequestInit) => {
			seen.push(init?.signal);
			return new Response('{}', {
				headers: { 'content-type': 'application/json' },
			});
		};
		await loadApi(fetcher, '/api/x');
		const own = new AbortController().signal;
		await loadApi(fetcher, '/api/x', { signal: own });
		expect(seen[0]).toBeInstanceOf(AbortSignal);
		expect(seen[1]).toBe(own);
	});

	it('turns a read cut off by its signal into the error a page shows', async () => {
		const hung = (_: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_, reject) => {
				if (init?.signal?.aborted) reject(init.signal.reason);
				init?.signal?.addEventListener('abort', () =>
					reject(init.signal?.reason),
				);
			});
		const res = await loadApi(hung, '/api/x', { signal: AbortSignal.abort() });
		expect(res).toEqual({
			ok: false,
			error: expect.objectContaining({ error: 'network' }),
		});
	});
});
