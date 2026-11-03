/**
 * The quality ladder (#3295, docs/spec/world.md "Climbing the ladder"): which
 * rung a ride's world draws at. The count-in probes this device, the ride
 * starts on the highest rung that keeps 30 fps, and a slow stretch steps it
 * down one rung at a time, never back up until the next ride. Pure, but for
 * the device's remembered rung; loads no three.js.
 */
import type { LoopStats } from './loop';
import { LIGHT_PIXEL_BUDGET, PIXEL_BUDGET } from './budget';

/** L1 to L3: L3 the world as designed, L1 the floor above the Skyline. */
export type Rung = 1 | 2 | 3;
export const TOP_RUNG: Rung = 3;

/** What a rung draws: its pixel budget, and whether the dressing's far ring (its stand-ins) shows. */
export const RUNGS: Record<Rung, { pixels: number; far: boolean }> = {
	3: { pixels: PIXEL_BUDGET, far: true },
	2: { pixels: PIXEL_BUDGET, far: false },
	1: { pixels: LIGHT_PIXEL_BUDGET, far: false },
};

/** docs/spec/world.md, "The ladder": GPU time a frame on the lab's rig, the ratios one rung's time predicts another's by. */
export const RUNG_GPU_MS: Record<Rung, number> = { 1: 1.95, 2: 2.5, 3: 4.15 };

/** docs/spec/world.md, "Climbing the ladder". */
export const LADDER = {
	/** A rung starts when its p90 GPU time a frame is at most this. */
	startMs: 10,
	/** A window is slow past this p90 GPU time a frame… */
	slowMs: 16,
	/** …or past this share of its vsync-divisor intervals missed. */
	slowShare: 0.05,
	windowS: 10,
	/** Slow windows in a row that step down. */
	strikes: 2,
	/** The share of startMs a rung must leave free for the next ride to climb to it. */
	headroom: 0.4,
} as const;

/** What a stretch of drawing measured: frames drawn and intervals missed, and each frame's GPU time where the browser times it. */
export type Measured = {
	rendered: number;
	missed: number;
	gpuMs: readonly number[];
};

/** The 90th percentile, nearest rank. */
export function p90(xs: readonly number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
}

const missedShare = (m: Measured) =>
	m.missed / Math.max(1, m.rendered + m.missed);

const clamp = (r: number): Rung => Math.min(TOP_RUNG, Math.max(1, r)) as Rung;

/**
 * The rung a ride starts on, from its count-in's probe drawn at `was` (the
 * rung this device was left on, the top when it has none): the highest
 * whose predicted p90 GPU time keeps under startMs, but never more than one
 * rung over `was`, and that only with headroom. Without GPU times, a
 * count-in that missed more than slowShare starts a rung under `was`.
 */
export function startRung(probe: Measured, was: Rung | null): Rung {
	const at = was ?? TOP_RUNG;
	if (probe.gpuMs.length === 0)
		return clamp(missedShare(probe) > LADDER.slowShare ? at - 1 : at);
	const measured = p90(probe.gpuMs);
	const predicted = (r: Rung) => (measured * RUNG_GPU_MS[r]) / RUNG_GPU_MS[at];
	let best: Rung = 1;
	for (const r of [3, 2, 1] as const)
		if (predicted(r) <= LADDER.startMs) {
			best = r;
			break;
		}
	if (best <= at) return best;
	const up = clamp(at + 1);
	return predicted(up) <= LADDER.startMs * (1 - LADDER.headroom) ? up : at;
}

/** A ride on the ladder: its rung and the slow windows in a row it has seen. */
export type Ladder = { rung: Rung; strikes: number };

/** A window is slow when it missed more than slowShare of its intervals, or its p90 GPU time passed slowMs. */
export const slow = (w: Measured): boolean =>
	missedShare(w) > LADDER.slowShare ||
	(w.gpuMs.length > 0 && p90(w.gpuMs) > LADDER.slowMs);

/** The ladder after a window: one rung down after `strikes` slow ones in a row, never under L1, never up. */
export function stepped(l: Ladder, w: Measured): Ladder {
	if (!slow(w)) return { rung: l.rung, strikes: 0 };
	if (l.strikes + 1 < LADDER.strikes)
		return { rung: l.rung, strikes: l.strikes + 1 };
	return { rung: clamp(l.rung - 1), strikes: 0 };
}

/**
 * Cuts the loop's stats, handed one a second with the GPU times since, into
 * windows of windowS seconds of drawing; a second that drew nothing (a gate
 * shut, the world at rest) is no part of one, as missWatch has it.
 */
export function windows() {
	let last: LoopStats | null = null;
	let open: Measured & { gpuMs: number[]; seconds: number } = fresh();
	function fresh() {
		return { rendered: 0, missed: 0, gpuMs: [] as number[], seconds: 0 };
	}
	return (stats: LoopStats, gpuMs: readonly number[]): Measured | null => {
		const before = last;
		last = stats;
		if (!before) return null;
		const rendered = stats.rendered - before.rendered;
		const missed = stats.missed - before.missed;
		if (rendered + missed === 0) return null;
		open.rendered += rendered;
		open.missed += missed;
		open.gpuMs.push(...gpuMs);
		if (++open.seconds < LADDER.windowS) return null;
		const done = open;
		open = fresh();
		return { rendered: done.rendered, missed: done.missed, gpuMs: done.gpuMs };
	};
}

const KEY = 'wattroom.world.tier.v1';

/** This device, as the ladder remembers it: its renderer and the canvas's size. */
export const deviceKey = (renderer: string, w: number, h: number) =>
	`${renderer}|${Math.round(w)}x${Math.round(h)}`;

function remembered(): Record<string, unknown> {
	const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
	return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export function rememberedRung(device: string): Rung | null {
	try {
		const r = remembered()[device];
		return r === 1 || r === 2 || r === 3 ? r : null;
	} catch {
		return null;
	}
}

// shortcut: one entry per renderer and canvas size, never pruned; prune when a rider's list is seen to grow.
export function rememberRung(device: string, rung: Rung): void {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ ...remembered(), [device]: rung }),
		);
	} catch {
		/* a browser that keeps nothing probes every ride */
	}
}
