import { pop } from './damp';

/**
 * The motion vocabulary (ADR-0079), as numbers for script — a Svelte
 * transition, a queue's hold, a stagger. app.css `@theme` carries the same
 * values for CSS, and motion-tokens.test.ts holds the two equal; the values
 * are docs/SPEC.md's "Motion" table.
 */
export const DUR = {
	press: 90,
	quick: 160,
	base: 240,
	reveal: 400,
	live: 500,
	stage: 700,
	draw: 1200,
} as const;

export const HOLD_ANNOUNCE = 2400;
export const STAGGER = 60;
export const STAGGER_PODIUM = 400;

type Bezier = readonly [number, number, number, number];

export const EASE = {
	arrive: [0.05, 0.7, 0.1, 1],
	leave: [0.3, 0, 0.8, 0.15],
	move: [0.2, 0, 0, 1],
	live: [0, 0, 0.2, 1],
} as const satisfies Record<string, Bezier>;

/**
 * CSS's cubic-bezier() as a function of progress, for an easing script needs:
 * Newton's method on x, falling back to bisection where the slope is flat.
 */
export function bezier([x1, y1, x2, y2]: Bezier): (t: number) => number {
	const at = (a: number, b: number, s: number) =>
		3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
	const slope = (a: number, b: number, s: number) =>
		3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
	return (x) => {
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		let s = x;
		for (let i = 0; i < 8; i++) {
			const d = slope(x1, x2, s);
			if (Math.abs(d) < 1e-6) break;
			s -= (at(x1, x2, s) - x) / d;
		}
		if (Math.abs(at(x1, x2, s) - x) > 1e-6) {
			let lo = 0;
			let hi = 1;
			s = x;
			for (let i = 0; i < 40; i++) {
				if (at(x1, x2, s) < x) lo = s;
				else hi = s;
				s = (lo + hi) / 2;
			}
		}
		return at(y1, y2, s);
	};
}

/** How finely `--ease-pop`'s linear() follows the spring: enough to keep its peak. */
const POP_STEPS = 24;

/** `--ease-pop` exactly as app.css spells it: the spring, resampled. */
export const POP_LINEAR = `linear(${Array.from(
	{ length: POP_STEPS + 1 },
	(_, i) => Number(pop(i / POP_STEPS).toFixed(3)),
).join(', ')})`;
