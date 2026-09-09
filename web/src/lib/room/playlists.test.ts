import { describe, expect, it, vi } from 'vitest';
import { commandFromLink } from './playlists.svelte';

// readLink's own branching is jukebox-add.test.ts's job (#615) — these cover
// only what commandFromLink adds on top of it: turning a parsed link into a
// save-able command.

describe('commandFromLink (#627)', () => {
	it("passes an unparseable link's message straight through", async () => {
		const result = await commandFromLink('not a link');
		expect(result).toEqual({
			ok: false,
			message: 'That does not look like a YouTube link or video id.',
		});
	});

	it('resolves a bare video id into an add command', async () => {
		const stub = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ title: 'Warmup Mix' }), { status: 200 }),
			);
		vi.stubGlobal('fetch', stub);
		try {
			const result = await commandFromLink('dQw4w9WgXcQ');
			expect(result).toMatchObject({
				ok: true,
				command: { action: 'add', videoId: 'dQw4w9WgXcQ', title: 'Warmup Mix' },
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
