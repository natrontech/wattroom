// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCustomStore } from './custom.svelte';

/**
 * The shelf is paged (#1414). What matters here is that the client walks
 * every page: the server answers 100 at a time, and a client that reads one
 * page and stops has reinvented the silent `limit 1000` the paging replaced.
 */
const workout = (n: number) => ({
	id: `w${n}`,
	savedAt: 1_000_000 + n,
	workout: {
		name: `Workout ${n}`,
		steps: [{ type: 'steady', seconds: 600, target: 0.7 }],
	},
});

/** Serves `total` workouts, 100 to a page, and records what was asked for. */
function shelfOf(total: number, max = 200) {
	const asked: string[] = [];
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(String(input), 'https://wattroom.test');
		asked.push(url.search);
		const from = Number(url.searchParams.get('beforeId')?.slice(1) ?? -1) + 1;
		const page = [];
		for (let n = from; n < Math.min(from + 100, total); n++)
			page.push(workout(n));
		const more = from + 100 < total;
		return new Response(
			JSON.stringify({
				workouts: page,
				more,
				max,
				...(more && {
					nextBefore: '2026-09-10T10:00:00Z',
					nextBeforeId: page[page.length - 1]?.id,
				}),
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	});
	return { asked, fetcher };
}

beforeEach(() => {
	localStorage.clear();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

/** The store loads itself on construction; this waits for it to settle. */
async function settled(store: ReturnType<typeof createCustomStore>) {
	for (let i = 0; i < 50 && !store.loaded; i++) await Promise.resolve();
	await store.retry();
	return store;
}

describe('the saved-workout shelf', () => {
	it('reads every page, not just the first', async () => {
		const { asked, fetcher } = shelfOf(215);
		vi.stubGlobal('fetch', fetcher);
		const store = await settled(createCustomStore());

		expect(store.all).toHaveLength(215);
		expect(new Set(store.all.map((e) => e.id)).size).toBe(215);
		// Three pages: 100, 100, 15 — and the last two carried a cursor.
		expect(asked.filter((q) => q.includes('beforeId')).length).toBeGreaterThan(
			0,
		);
	});

	it('stops at one page when the server says there is no more', async () => {
		const { asked, fetcher } = shelfOf(40);
		vi.stubGlobal('fetch', fetcher);
		const store = await settled(createCustomStore());

		expect(store.all).toHaveLength(40);
		expect(asked.filter((q) => q.includes('beforeId'))).toHaveLength(0);
	});

	it('knows the shelf is full so a create surface can say so before the 429', async () => {
		const { fetcher } = shelfOf(200);
		vi.stubGlobal('fetch', fetcher);
		expect((await settled(createCustomStore())).full).toBe(true);
	});

	it('is not full below the ceiling, and not full before the ceiling is known', async () => {
		const { fetcher } = shelfOf(199);
		vi.stubGlobal('fetch', fetcher);
		expect((await settled(createCustomStore())).full).toBe(false);

		// A read that failed reports no ceiling: an unknown shelf must not
		// disable the button (errors.md — that is an error state, not a full
		// shelf, and it says so with its own retry).
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 })),
		);
		const broken = createCustomStore();
		await settled(broken);
		expect(broken.full).toBe(false);
		expect(broken.error).not.toBeNull();
	});
});
