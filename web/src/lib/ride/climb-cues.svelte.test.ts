// @vitest-environment happy-dom
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ClimbView } from './climb-view';
import type { GhostCall } from './ghost-split.svelte';

const played: string[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => played.push(id) }));
const { watchClimbCues, climbStage } = await import('./climb-cues.svelte');

const at = (
	startM: number,
	summited = false,
	flammeRouge = false,
	cls = 'IV',
) =>
	({
		card: { summited, flammeRouge },
		climb: { startM, topM: startM + 1000, gainM: 80, cls },
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

	it('spends confetti at HC and I only, and stamps the flamme once on ease-pop', async () => {
		vi.useFakeTimers();
		vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
		for (const [cls, confetti] of [
			['HC', true],
			['IV', false],
		] as const) {
			let view = $state<ClimbView | null>(null);
			const stop = $effect.root(() => watchClimbCues(() => view));
			view = at(1000, false, false, cls);
			await tick();
			vi.advanceTimersByTime(4000);
			view = at(1000, true, false, cls);
			await tick();
			vi.advanceTimersByTime(500);
			expect(climbStage.summit?.confetti).toBe(confetti);
			vi.advanceTimersByTime(9000);
			stop();
		}
		vi.useRealTimers();
	});
});

describe('your ghost’s calls take the strip (#3246)', () => {
	it('stages each call once, on its own cue, a new best on the fanfare', async () => {
		vi.useFakeTimers();
		vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
		played.length = 0;
		let call = $state.raw<GhostCall | null>(null);
		// The ride's clock: the getter is read again every second.
		let second = $state(0);
		const stop = $effect.root(() =>
			watchClimbCues(
				() => null,
				() => (second >= 0 ? call : null),
			),
		);
		const halfway: GhostCall = {
			kind: 'split',
			name: 'Halfway',
			line: 'Your best · 12 s ahead',
			said: 'Halfway, 12 seconds ahead of your best',
		};
		call = halfway;
		await tick();
		vi.advanceTimersByTime(100);
		expect(climbStage.call).toMatchObject({ name: 'Halfway' });
		// The same call read again, past the queue's merge window: never a
		// second entrance.
		vi.advanceTimersByTime(2000);
		second += 1;
		await tick();
		vi.advanceTimersByTime(12_000);
		expect(climbStage.call).toBeNull();
		expect(played).toEqual(['split']);
		call = {
			kind: 'pr',
			name: 'New best',
			line: '14 s faster',
			said: 'New best on The Pass, 14 seconds faster',
		};
		await tick();
		vi.advanceTimersByTime(100);
		expect(climbStage.call).toMatchObject({ line: '14 s faster' });
		expect(played).toEqual(['split', 'fanfare']);
		stop();
		expect(climbStage.call).toBeNull();
		vi.useRealTimers();
	});
});
