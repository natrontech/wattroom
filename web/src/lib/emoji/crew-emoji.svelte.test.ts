// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The crew's list as the server holds it. Counting reads IS the assertion
// for the loop: a clock in chat must not cost a read every half minute.
let fetches = 0;
let emoji: { id: string; name: string }[] = [];
vi.mock('$lib/api', () => ({
	api: async () => {
		fetches += 1;
		return { ok: true, data: { emoji: structuredClone(emoji) } };
	},
}));

const { crewEmoji, loadCrewEmoji } = await import('./crew-emoji.svelte');

describe('a crew emoji nobody here knows yet', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetches = 0;
		emoji = [];
	});
	afterEach(() => vi.useRealTimers());

	it('draws once the window closes, without a reload', async () => {
		await loadCrewEmoji('fresh');
		// A member added it a moment after this rider's list was read.
		emoji = [{ id: 'e1', name: 'party' }];
		let src: string | null = null;
		const stop = $effect.root(() => {
			$effect(() => {
				src = crewEmoji.url('fresh', 'party');
			});
		});
		flushSync();
		expect(src).toBeNull();
		await vi.advanceTimersByTimeAsync(30_000);
		flushSync();
		expect(src).toBe('/api/crews/fresh/emoji/e1');
		stop();
	});

	it('does not ask forever about a clock', async () => {
		await loadCrewEmoji('clock');
		const stop = $effect.root(() => {
			$effect(() => {
				crewEmoji.url('clock', '30'); // 18:30:00
			});
		});
		flushSync();
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		flushSync();
		expect(fetches).toBe(2);
		stop();
	});
});
