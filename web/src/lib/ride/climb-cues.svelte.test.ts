// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ClimbView } from './climb-view';

const played: string[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
const { watchClimbCues, climbStage } = await import('./climb-cues.svelte');

const at = (startM: number, summited = false, flammeRouge = false) =>
	({
		card: { summited, flammeRouge },
		climb: { startM, topM: startM + 1000, gainM: 80, cls: 'IV' },
	}) as unknown as ClimbView;

describe('the climb card says so (#3645)', () => {
	it('stages climb, flamme and summit once a climb, each on its own cue', async () => {
		vi.useFakeTimers();
		vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
		let view = $state<ClimbView | null>(null);
		const stop = $effect.root(() => watchClimbCues(() => view));
		// An effect in a bare root runs a microtask after the write.
		const step = async (next: ClimbView | null, ms = 0) => {
			view = next;
			await tick();
			vi.advanceTimersByTime(ms);
		};
		await step(at(1000), 100);
		await step(at(1000), 100); // the next second, the same climb
		expect(played).toEqual(['climb']);
		expect(climbStage.slide).toBe(true);
		await step(at(1000, false, true), 3400);
		expect(climbStage.slide).toBe(false);
		expect(climbStage.flammeStamp).toBe(true);
		await step(at(1000, true, true), 1000);
		await step(at(1000, true, true), 8000);
		expect(played).toEqual(['climb', 'summit']);
		expect(climbStage.summit).toBeNull();
		stop();
		vi.useRealTimers();
	});
});
