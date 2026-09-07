/**
 * Turning a pointer into a workout value, for the editor's draggable graph (#1006).
 *
 * Pure on purpose: the component measures and renders, this decides. Bounds are
 * `validate.ts`'s LIMITS rather than numbers invented in a drag handler — a drag
 * must not be able to build a workout the validator would then refuse.
 */
import { CEILING } from './zones';
import { stepAt, reorder } from '$lib/workout/tree';
import { LIMITS } from '$lib/workout/validate';
import type { Workout } from '$lib/workout/types';

/**
 * The graph's viewBox. The SVG stretches to its box (`preserveAspectRatio="none"`),
 * so a pointer position is converted into these units before anything else.
 */
export const VIEW = { width: 1000, height: 120, base: 112 } as const;

/** Fraction of FTP → viewBox units. The ceiling is the shared one, so a drag
 *  cannot reach a height the read-only rendering would clip. */
export const SCALE = (VIEW.base - 8) / CEILING;

/** How close to an edge counts as grabbing it, in viewBox units. */
export const EDGE = 8;

export const SNAP_SECONDS = 5;
export const SNAP_FRACTION = 0.01;

export const xOf = (seconds: number, total: number): number =>
	total > 0 ? (seconds / total) * VIEW.width : 0;

export const yOf = (fraction: number): number =>
	VIEW.base - Math.min(fraction, CEILING) * SCALE;

/** viewBox x → seconds along the timeline. */
export function secondsAt(vx: number, total: number): number {
	return (vx / VIEW.width) * total;
}

/** viewBox y → fraction of FTP. */
export function fractionAt(vy: number): number {
	return (VIEW.base - vy) / SCALE;
}

/** Snapped to 5 s and held inside validate.ts's step bounds; `free` skips the snap (Alt). */
export function stepSeconds(seconds: number, free = false): number {
	const snapped = free
		? Math.round(seconds)
		: Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS;
	return Math.min(LIMITS.maxSeconds, Math.max(LIMITS.minSeconds, snapped));
}

/** Snapped to 1 % FTP and held inside validate.ts's fraction bounds. */
export function stepFraction(fraction: number, free = false): number {
	const snapped = free
		? fraction
		: Math.round(fraction / SNAP_FRACTION) * SNAP_FRACTION;
	// A fraction has to be above zero, and snapping to 1 % puts 0 within reach.
	const bounded = Math.min(
		LIMITS.maxFraction,
		Math.max(SNAP_FRACTION, snapped),
	);
	// 1 % steps are not exact in binary floating point, and a stored
	// 0.7300000000000001 renders as 73 and writes back as something else.
	return Math.round(bounded * 1000) / 1000;
}

export type GrabKind = 'target' | 'rampFrom' | 'rampTo' | 'seconds' | 'reorder';

export interface Block {
	x0: number;
	x1: number;
	/** Top edge in viewBox units, at the block's left and right ends. */
	yFrom: number;
	yTo: number;
	kind: 'steady' | 'ramp' | 'sprint';
}

/**
 * What a pointer at (vx, vy) has hold of. The right edge is the boundary with
 * the next block, so dragging it is this step's duration; the top edge is its
 * target; anything else is the body, which reorders.
 */
export function grabAt(vx: number, vy: number, block: Block): GrabKind {
	const width = Math.max(1, block.x1 - block.x0);
	// A short block must not be all edge — a third of it stays draggable body.
	const edge = Math.min(EDGE, width / 3);
	if (block.x1 - vx <= edge) return 'seconds';
	const top =
		block.yFrom + ((block.yTo - block.yFrom) * (vx - block.x0)) / width;
	// A sprint is all-out by definition: it has no target to drag.
	if (block.kind !== 'sprint' && Math.abs(vy - top) <= EDGE) {
		if (block.kind !== 'ramp') return 'target';
		// A ramp's two ends move independently — that is what a ramp is.
		return vx - block.x0 < block.x1 - vx ? 'rampFrom' : 'rampTo';
	}
	return 'reorder';
}

export type GraphEdit =
	| { kind: 'target' | 'rampFrom' | 'rampTo'; path: number[]; fraction: number }
	| { kind: 'seconds'; path: number[]; seconds: number }
	| { kind: 'reorder'; path: number[]; to: number };

/** Applies one edit to the sheet. Anything that does not make sense is ignored. */
export function applyEdit(
	workout: Workout,
	edit: GraphEdit,
	ftp: number,
): void {
	if (edit.kind === 'reorder') {
		reorder(workout, edit.path, edit.to);
		return;
	}
	const step = stepAt(workout, edit.path);
	if (!step || step.type === 'repeat' || step.type === 'sprint') return;
	if (edit.kind === 'seconds') {
		step.seconds = edit.seconds;
		return;
	}
	if (step.type === 'steady') {
		if (edit.kind !== 'target') return;
		// A step written in absolute watts stays written in absolute watts:
		// converting it to a fraction would re-scale it at the rider's next
		// FTP change, which is not what dragging one block asked for.
		if (step.watts !== undefined) step.watts = Math.round(edit.fraction * ftp);
		else step.target = edit.fraction;
		return;
	}
	if (edit.kind === 'rampFrom') step.from = edit.fraction;
	if (edit.kind === 'rampTo') step.to = edit.fraction;
}
