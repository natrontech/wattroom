import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pop } from './damp';
import {
	bezier,
	DUR,
	EASE,
	HOLD_ANNOUNCE,
	POP_LINEAR,
	STAGGER,
	STAGGER_PODIUM,
} from './tokens';

/**
 * One motion vocabulary, spelled twice (#3207): app.css `@theme` for CSS and
 * tokens.ts for script. A value changed on one side only is a transition that
 * no longer matches the one beside it, and nothing would say so.
 */
const CSS = readFileSync(join(import.meta.dirname, '../../app.css'), 'utf8');

/** A declaration's value, whitespace collapsed the way prettier may wrap it. */
function token(name: string): string | undefined {
	return CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]
		.replace(/\s+/g, ' ')
		.replace(/\(\s/g, '(')
		.replace(/,?\s\)/g, ')')
		.trim();
}
const declared = (prefix: string) =>
	[...CSS.matchAll(new RegExp(`--${prefix}-([a-z]+):`, 'g'))].map((m) => m[1]);

describe('app.css and $lib/motion agree (#3207)', () => {
	it('on every duration and timing', () => {
		for (const [name, ms] of Object.entries(DUR))
			expect(token(`dur-${name}`), `--dur-${name}`).toBe(`${ms}ms`);
		expect(token('hold-announce')).toBe(`${HOLD_ANNOUNCE}ms`);
		expect(token('stagger')).toBe(`${STAGGER}ms`);
		expect(token('stagger-podium')).toBe(`${STAGGER_PODIUM}ms`);
		expect(declared('dur').sort()).toEqual(Object.keys(DUR).sort());
	});

	it('on every easing, the resampled spring included', () => {
		for (const [name, curve] of Object.entries(EASE))
			expect(token(`ease-${name}`), `--ease-${name}`).toBe(
				`cubic-bezier(${curve.join(', ')})`,
			);
		expect(token('ease-pop')).toBe(POP_LINEAR);
		expect(declared('ease').sort()).toEqual(
			[...Object.keys(EASE), 'pop'].sort(),
		);
	});
});

describe('the curves script uses', () => {
	it('solves cubic-bezier() the way CSS does', () => {
		const straight = bezier([1 / 3, 1 / 3, 2 / 3, 2 / 3]);
		for (const x of [0.1, 0.37, 0.8]) expect(straight(x)).toBeCloseTo(x, 4);
		// CSS `ease` at half time, the figure every implementation agrees on.
		expect(bezier([0.25, 0.1, 0.25, 1])(0.5)).toBeCloseTo(0.8024, 3);
		expect(bezier(EASE.arrive)(0)).toBe(0);
		expect(bezier(EASE.leave)(1)).toBe(1);
	});

	it('springs the pop to SPEC’s 8 % overshoot and lands on 1', () => {
		const samples = Array.from({ length: 1001 }, (_, i) => pop(i / 1000));
		expect(samples[0]).toBe(0);
		expect(samples[1000]).toBe(1);
		expect(Math.max(...samples)).toBeGreaterThan(1.07);
		expect(Math.max(...samples)).toBeLessThan(1.09);
	});
});
