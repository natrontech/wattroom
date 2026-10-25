import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import IntervalStrip from './IntervalStrip.svelte';
import type { Block } from '$lib/workout/block';

const block = (secondsLeft: number): Block => ({
	index: 2,
	count: 5,
	label: 'Threshold',
	watts: 250,
	secondsLeft,
	band: { low: 238, high: 262 },
	last: null,
	next: { label: 'Sprint', watts: 400, seconds: 15 },
	trainer: { kind: 'erg' },
});

const lit = (html: string) =>
	[...html.matchAll(/data-testid="count-chip" class="([^"]*)">(\d)</g)]
		.filter((m) => /\bborder-neon\b(?!\/)/.test(m[1]))
		.map((m) => m[2]);

describe('slot 1 on the TV (#3677)', () => {
	it('counts the last three seconds beside NEXT, as the world does', () => {
		const at = (s: number) =>
			render(IntervalStrip, { props: { block: block(s), bias: 1, big: true } })
				.body;
		expect(at(10).match(/data-testid="count-chip"/g)).toHaveLength(3);
		expect(lit(at(10))).toEqual([]);
		expect(lit(at(2.4))).toEqual(['3']);
		expect(lit(at(0.5))).toEqual(['1']);
	});
});
