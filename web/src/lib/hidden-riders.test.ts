import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/friends/friends.svelte', () => ({
	friends: { reload: async () => {} },
}));
vi.mock('$lib/dm/heads.svelte', () => ({ dmHeads: { refresh: () => {} } }));
const pushed = vi.hoisted(
	() => [] as { text: string; opts?: { tone?: string; undo?: () => void } }[],
);
vi.mock('$lib/toast.svelte', () => ({
	toasts: {
		push: (text: string, opts?: { tone?: string; undo?: () => void }) =>
			pushed.push({ text, opts }),
	},
}));

import { hiddenRiders, stillTogether } from './hidden-riders.svelte';

type Call = [string, RequestInit | undefined];

/** A server that answers every route, and records what was asked. */
function serve(page: { crewsInCommon: { id: string; name: string }[] }) {
	const calls: Call[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init?: RequestInit) => {
			calls.push([path, init]);
			const body =
				path === '/api/blocks' && !init?.method
					? { riders: [] }
					: path.startsWith('/api/riders/')
						? { id: 'ana', displayName: 'Ana', ...page }
						: { ok: true };
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
	return calls;
}

afterEach(() => {
	vi.unstubAllGlobals();
	pushed.length = 0;
});

describe('hiddenRiders (#3202)', () => {
	it('hides at once, says what it does not do, and undoes quietly', async () => {
		const calls = serve({ crewsInCommon: [{ id: 'c1', name: 'Tuesday' }] });
		expect(await hiddenRiders.hide('ana', 'Ana')).toBe(true);
		expect(calls).toContainEqual([
			'/api/blocks',
			expect.objectContaining({ method: 'POST' }),
		]);
		expect(pushed).toHaveLength(1);
		expect(pushed[0].text).toBe(`Ana is hidden. ${stillTogether('Tuesday')}`);

		pushed[0].opts?.undo?.();
		await vi.waitFor(() =>
			expect(calls).toContainEqual([
				'/api/blocks/ana',
				expect.objectContaining({ method: 'DELETE' }),
			]),
		);
		// The undo is the answer; a second toast would only repeat it.
		await new Promise((r) => setTimeout(r, 0));
		expect(pushed).toHaveLength(1);
	});

	it('names no crew where none is shared', async () => {
		serve({ crewsInCommon: [] });
		await hiddenRiders.hide('ana', 'Ana');
		expect(pushed[0].text).toBe('Ana is hidden.');
	});

	it('says why it failed, and reports it did not happen', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: 'not_found', message: 'No rider there.' }),
						{ status: 404 },
					),
			),
		);
		expect(await hiddenRiders.hide('ghost', 'Ghost')).toBe(false);
		expect(pushed).toEqual([
			{ text: 'No rider there.', opts: { tone: 'error' } },
		]);
	});
});
