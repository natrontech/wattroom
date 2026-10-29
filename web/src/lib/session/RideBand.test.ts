import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RideBand from './RideBand.svelte';
import type { Block, BlockTrainer } from '$lib/workout/block';

const block = (trainer: BlockTrainer): Block => ({
	index: 2,
	count: 4,
	label: 'Threshold',
	watts: 262,
	secondsLeft: 120,
	band: { low: 249, high: 275 },
	last: null,
	next: null,
	trainer,
});

const chip = (trainer: BlockTrainer, drives = true) => {
	const body = render(RideBand, {
		props: { block: block(trainer), elapsed: 60, total: 600, drives },
	}).body;
	const match = body.match(/data-testid="trainer-chip"[^>]*>([^<]*)</);
	return match ? match[1].replace(/\s+/g, ' ').trim() : null;
};

// Slot 1's trainer chip (#3485, ADR-0062): how the trainer rides the block.
describe('the trainer chip', () => {
	it('says the watts it holds, to the watts', () => {
		expect(chip({ kind: 'erg' })).toBe('Watts · 262 W');
	});

	it('says the road is scenery on a route that runs by the clock', () => {
		expect(chip({ kind: 'scenery' })).toBe('ERG: the road is scenery');
	});

	it('says the road and how it is felt, in place of ERG, on the road in SIM', () => {
		expect(chip({ kind: 'road', grade: 8.94, felt: 4.47 })).toBe(
			'SIM · you feel 4.5 %',
		);
	});

	it('names no mode on a screen that does not drive the trainer', () => {
		for (const trainer of [
			{ kind: 'erg' },
			{ kind: 'scenery' },
			{ kind: 'road', grade: 5, felt: 2.5 },
		] as BlockTrainer[])
			expect(chip(trainer, false)).toBeNull();
	});
});

// TARGETS Flows rule 2: the workout keeps its name once the block has one.
describe('the context eyebrow', () => {
	const body = (context?: string) =>
		render(RideBand, {
			props: {
				block: block({ kind: 'erg' }),
				elapsed: 60,
				total: 600,
				title: 'Smoke Test',
				context,
			},
		}).body;

	it('names the workout above the block that is riding', () => {
		const html = body('Solo · Smoke Test');
		expect(html).toMatch(
			/data-testid="ride-context"[^>]*>\s*Solo · Smoke Test/,
		);
		expect(html.indexOf('ride-context')).toBeLessThan(
			html.indexOf('Threshold'),
		);
	});

	it('draws nothing when the screen has no context to give', () => {
		expect(body()).not.toContain('ride-context');
	});
});

// #4159: flat, the graph below is the workout's one picture. With no strip,
// NEXT stands beside the clock in the block's row, not in a row of its own
// under an empty column.
describe('flat slot 1 without a strip', () => {
	it('sets NEXT in the clock row', () => {
		const html = render(RideBand, {
			props: {
				block: {
					...block({ kind: 'erg' }),
					next: { label: 'Recovery', watts: 120, seconds: 300 },
				},
				elapsed: 60,
				total: 600,
				drives: true,
				wide: true,
			},
		}).body;
		const after = html.slice(html.indexOf('Recovery · 120 W · 5 min'));
		expect(after.indexOf('</div>')).toBeGreaterThan(-1);
		expect(after.indexOf('</div>')).toBeLessThan(after.indexOf('</header>'));
	});
});
