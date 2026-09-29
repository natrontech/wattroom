import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	code,
	FILES,
	scan,
	stale,
	type Allowlist,
} from '$lib/source-scan.test-helper';

/**
 * Reduced motion reaches every animation (#3208, ADR-0079). app.css stills
 * CSS transitions for everyone in one rule, but a `@keyframes` animation and a
 * Svelte transition (the Web Animations API) never hear it: each has to ask,
 * and the e2e counted only transitions, so neither kind was checked at all.
 */
const SRC = join(import.meta.dirname, '../..');

/** A component whose `@keyframes` is not motion, and why. */
const KEYFRAMES: Allowlist = {
	'routes/(app)/+layout.svelte':
		'nav-pending-show is a 0 s step that only delays showing the pending bar — nothing moves',
};

describe('reduced motion (#3208)', () => {
	it('is asked by every component that animates with @keyframes', () => {
		const used = new Set<string>();
		const offenders = FILES.filter((file) => {
			if (!file.endsWith('.svelte')) return false;
			const source = code(readFileSync(join(SRC, file), 'utf8'));
			if (!/@keyframes|\banimation:/.test(source)) return false;
			if (/prefers-reduced-motion/.test(source)) return false;
			if (KEYFRAMES[file]) {
				used.add(file);
				return false;
			}
			return true;
		});
		expect(
			offenders,
			`@keyframes with nothing stilling it:\n  ${offenders.join('\n  ')}\n` +
				'Add `@media (prefers-reduced-motion: reduce) { … animation: none; }` ' +
				'beside it. A keyframe that moves nothing goes in KEYFRAMES with its reason.',
		).toEqual([]);
		expect(stale(KEYFRAMES, used)).toEqual([]);
	});

	it('reaches Svelte transitions only through $lib/motion', () => {
		const home: Allowlist = {
			'lib/motion/': 'the transitions, each asking prefersReducedMotion',
		};
		const { offenders } = scan(
			/from\s+['"]svelte\/(?:transition|animate)['"]/g,
			home,
		);
		expect(
			offenders,
			`A transition that does not ask about reduced motion:\n${offenders.join('\n')}\n` +
				'Use enter, exit, pop, swap or reorder from $lib/motion/transitions.',
		).toEqual([]);
	});
});
