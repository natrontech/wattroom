/**
 * Named spans round the hot paths (#4541): the world's frame, the lounge's,
 * a channel message and the Svelte update it causes. With `?perf` on, each
 * span is a `performance.measure('wattroom:<name>')`, so a Chrome or Electron
 * Performance trace names it in its Timings track, and a sample in the
 * overlay's aggregator. Off, `begin()` returns 0 and `end()` returns at once:
 * no timestamp, no entry, no allocation.
 *
 * Gated rather than always on: the browser keeps every measure in the page's
 * timeline until it is cleared, and the world alone makes 90 a second, so an
 * always-on mark is a two-hour ride's heap growing by 600k entries (or a
 * clear on the frame path), for a trace nobody records. A trace is recorded
 * on purpose, so turning `?perf` on first is no burden.
 */
import { tick } from 'svelte';
import { perfOn } from './flag';
import { createAggregator } from './stats';

/** The spans the app names. Stable: docs/PERFORMANCE.md and traces refer to them. */
export type PerfSpan =
	| 'world-frame'
	| 'world-advance'
	| 'world-draw'
	| 'lounge-frame'
	| 'channel-message'
	| 'trainer-sample';

export const PREFIX = 'wattroom:';

/** Five seconds of page frames, long tasks and spans; null while `?perf` is off. */
export const perfStats = perfOn ? createAggregator(5000) : null;

/** Measures per name before that name's are cleared from the timeline. */
const CLEAR_EVERY = 600;
const made = new Map<string, number>();

/** A span's start: 0 while `?perf` is off. */
export function begin(): number {
	return perfOn ? performance.now() : 0;
}

/** Ends the span `name` begun at `start`. */
export function end(name: PerfSpan, start: number): void {
	if (!perfOn || start === 0) return;
	const now = performance.now();
	const full = PREFIX + name;
	performance.measure(full, { start, end: now });
	perfStats?.span(name, now - start, now);
	const n = (made.get(full) ?? 0) + 1;
	if (n < CLEAR_EVERY) made.set(full, n);
	else {
		// A trace has them already: the timeline is not where they are read.
		made.set(full, 0);
		performance.clearMeasures(full);
	}
}

/**
 * Ends the span once Svelte has applied what the running task changed: call
 * it at the span's start, and Svelte's tick() flushes, after the task, the
 * state it wrote, so the span holds the DOM update the change caused.
 */
export function endAfterFlush(name: PerfSpan, start: number): void {
	if (!perfOn || start === 0) return;
	void tick().then(() => end(name, start));
}

/** What the overlay and the bench read off a live world. */
export type WorldReading = {
	stats(): { rendered: number; missed: number; hz: number };
	renderer(): {
		draws: number;
		triangles: number;
		geometries: number;
		textures: number;
		programs: number;
		pixelRatio: number;
	};
	/** A dev build's frames since the last call (scene.ts). */
	frames(): { at: number; ms: number }[];
	/** The quality ladder's rung, when it climbs. */
	rung(): number;
};

const worlds = new Set<WorldReading>();

/** A world says it is live; the returned function says it is gone. A no-op while `?perf` is off. */
export function watchWorld(world: WorldReading): () => void {
	if (!perfOn) return () => {};
	worlds.add(world);
	return () => worlds.delete(world);
}

/** The live worlds, newest last. */
export function liveWorlds(): WorldReading[] {
	return [...worlds];
}

// The bench's handle (web/scripts/world-bench.mjs): the same numbers the overlay shows.
if (perfOn && typeof window !== 'undefined')
	Object.assign(window, {
		wattroomPerf: {
			summary: () => perfStats?.summary(performance.now()),
			world: () => liveWorlds().at(-1) ?? null,
			worlds: () => liveWorlds().length,
		},
	});
