// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ClimbView } from './climb-view';

const played: string[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
const { watchClimbCues } = await import('./climb-cues.svelte');

const at = (startM: number, summited = false) =>
	({
		card: { summited },
		climb: { startM, topM: startM + 1000, gainM: 80, cls: 'IV' },
	}) as unknown as ClimbView;

describe('the climb card says so (#3645)', () => {
	it('sounds climb once a climb, summit once at its top, and again for the next', async () => {
		let view = $state<ClimbView | null>(null);
		const stop = $effect.root(() => watchClimbCues(() => view));
		// An effect in a bare root runs a microtask after the write.
		const step = async (next: ClimbView | null) => {
			view = next;
			await tick();
		};
		await step(at(1000));
		await step(at(1000)); // the next second, the same climb
		expect(played).toEqual(['climb']);
		await step(at(1000, true));
		await step(at(1000, true));
		expect(played).toEqual(['climb', 'summit']);
		await step(null);
		await step(at(5000));
		expect(played).toEqual(['climb', 'summit', 'climb']);
		stop();
	});
});
