import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	applyEdit,
	fractionAt,
	grabAt,
	secondsAt,
	stepFraction,
	stepSeconds,
	VIEW,
	yOf,
	type Block,
} from './graph-edit';
import { LIMITS } from '$lib/workout/validate';
import { validateWorkout } from '$lib/workout/validate';
import type {
	RampStep,
	RepeatStep,
	SteadyStep,
	Workout,
} from '$lib/workout/types';

describe('pixel → value', () => {
	it('maps the timeline across the full width', () => {
		expect(secondsAt(0, 600)).toBe(0);
		expect(secondsAt(VIEW.width / 2, 600)).toBe(300);
		expect(secondsAt(VIEW.width, 600)).toBe(600);
	});

	it('round-trips a fraction through the vertical scale', () => {
		for (const fraction of [0.5, 1, 1.2]) {
			expect(fractionAt(yOf(fraction))).toBeCloseTo(fraction, 10);
		}
	});

	it('puts the baseline at zero', () => {
		expect(fractionAt(VIEW.base)).toBe(0);
	});
});

describe('snapping', () => {
	it('holds duration to 5 s, and lets Alt out of it', () => {
		expect(stepSeconds(302)).toBe(300);
		expect(stepSeconds(303)).toBe(305);
		expect(stepSeconds(302.4, true)).toBe(302);
	});

	it('holds a target to 1 % FTP, and lets Alt out of it', () => {
		expect(stepFraction(0.7534)).toBe(0.75);
		expect(stepFraction(0.7551)).toBe(0.76);
		expect(stepFraction(0.7534, true)).toBe(0.753);
	});
});

describe('bounds come from validate.ts', () => {
	it('clamps duration to the rideable range', () => {
		expect(stepSeconds(0)).toBe(LIMITS.minSeconds);
		expect(stepSeconds(-500)).toBe(LIMITS.minSeconds);
		expect(stepSeconds(LIMITS.maxSeconds * 2)).toBe(LIMITS.maxSeconds);
	});

	it('never produces a fraction of zero or above the ceiling', () => {
		expect(stepFraction(0)).toBeGreaterThan(0);
		expect(stepFraction(-1)).toBeGreaterThan(0);
		expect(stepFraction(99)).toBe(LIMITS.maxFraction);
	});

	it('a dragged sheet still passes the validator at either extreme', () => {
		const workout: Workout = {
			name: 'Dragged',
			steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
		};
		for (const [vy, vx] of [
			[-9999, -9999],
			[9999, 9999],
		]) {
			applyEdit(
				workout,
				{ kind: 'target', path: [0], fraction: stepFraction(fractionAt(vy)) },
				250,
			);
			applyEdit(
				workout,
				{
					kind: 'seconds',
					path: [0],
					seconds: stepSeconds(secondsAt(vx, 600)),
				},
				250,
			);
			expect(validateWorkout(workout).ok).toBe(true);
		}
	});
});

describe('what the pointer has hold of', () => {
	const block = (kind: Block['kind'], yFrom = 50, yTo = 50): Block => ({
		x0: 100,
		x1: 300,
		yFrom,
		yTo,
		kind,
	});

	it('reads the right edge as duration', () => {
		expect(grabAt(298, 80, block('steady'))).toBe('seconds');
	});

	it('reads the top edge as the target', () => {
		expect(grabAt(200, 52, block('steady'))).toBe('target');
	});

	it('reads the body as a reorder', () => {
		expect(grabAt(200, 100, block('steady'))).toBe('reorder');
	});

	it('gives a ramp two ends that move separately', () => {
		const ramp = block('ramp', 80, 20);
		expect(grabAt(130, 74, ramp)).toBe('rampFrom');
		expect(grabAt(270, 26, ramp)).toBe('rampTo');
	});

	it('gives a sprint no target — it is all-out by definition', () => {
		expect(grabAt(200, 52, block('sprint'))).toBe('reorder');
	});

	it('leaves a short block a draggable body', () => {
		const narrow: Block = {
			x0: 100,
			x1: 109,
			yFrom: 50,
			yTo: 50,
			kind: 'steady',
		};
		expect(grabAt(103, 100, narrow)).toBe('reorder');
	});
});

describe('applying an edit', () => {
	const nested = (): Workout => ({
		name: 'Test',
		steps: [
			{ type: 'steady', seconds: 600, target: 0.6 },
			{
				type: 'repeat',
				times: 3,
				steps: [
					{ type: 'ramp', seconds: 60, from: 0.5, to: 0.8 },
					{ type: 'steady', seconds: 120, watts: 200 },
				],
			},
		],
	});

	it('edits a repeat child at its own path', () => {
		const w = nested();
		applyEdit(w, { kind: 'rampTo', path: [1, 0], fraction: 1.1 }, 250);
		expect(((w.steps[1] as RepeatStep).steps[0] as RampStep).to).toBe(1.1);
		expect(((w.steps[1] as RepeatStep).steps[0] as RampStep).from).toBe(0.5);
	});

	it('keeps an absolute-watt step written in watts', () => {
		const w = nested();
		applyEdit(w, { kind: 'target', path: [1, 1], fraction: 1.2 }, 250);
		const step = (w.steps[1] as RepeatStep).steps[1] as SteadyStep;
		expect(step.watts).toBe(300);
		expect(step.target).toBeUndefined();
	});

	it('reorders among siblings', () => {
		const w = nested();
		applyEdit(w, { kind: 'reorder', path: [1, 1], to: 0 }, 250);
		expect((w.steps[1] as RepeatStep).steps.map((s) => s.type)).toEqual([
			'steady',
			'ramp',
		]);
	});

	it('ignores what makes no sense — a repeat has no target', () => {
		const w = nested();
		const before = JSON.stringify(w);
		applyEdit(w, { kind: 'target', path: [1], fraction: 1 }, 250);
		applyEdit(w, { kind: 'target', path: [9], fraction: 1 }, 250);
		expect(JSON.stringify(w)).toBe(before);
	});
});

/**
 * The graph renders on the ride screens, the room, the history detail and the
 * workouts list, where it has to stay read-only — the AC calls a regression
 * there the main risk in this change, so it is pinned rather than eyeballed.
 */
describe('read-only everywhere but the editor', () => {
	const SRC = new URL('../../', import.meta.url).pathname;

	function svelteFiles(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) svelteFiles(full, out);
			else if (entry.name.endsWith('.svelte')) out.push(full);
		}
		return out;
	}

	it('defaults the prop off', () => {
		const source = readFileSync(
			join(SRC, 'lib/components/IntervalGraph.svelte'),
			'utf8',
		);
		expect(source).toContain('editable = false');
	});

	it('is opted into by exactly one surface', () => {
		const optedIn = svelteFiles(SRC)
			.filter((file) => {
				const source = readFileSync(file, 'utf8');
				return (
					source.includes('IntervalGraph') && /^\s+editable\b/m.test(source)
				);
			})
			.map((file) => file.slice(SRC.length));
		expect(optedIn).toEqual(['routes/workouts/edit/+page.svelte']);
	});
});
