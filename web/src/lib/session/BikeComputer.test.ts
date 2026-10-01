import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BikeComputer from './BikeComputer.svelte';
import type { LiveStats } from '$lib/ride/live-stats.svelte';

const stats: LiveStats = {
	seconds: 60,
	power3: 251,
	power10: 248,
	power30: 240,
	normPower: 236,
	intensity: 0.94,
	load: 1.5,
	kj: 14,
	zoneSeconds: [0, 0, 10, 20, 30, 0, 0, 0],
	blockAverage: 238,
	blockExecution: null,
};

const draw = (props: Record<string, unknown> = {}) =>
	render(BikeComputer, {
		props: { watts: 250, cadence: 90, hr: 150, kg: 75, stale: false, ...props },
	}).body;

/** Tailwind's named sizes, in px at the default root. */
const PX: Record<string, number> = {
	'text-xs': 12,
	'text-sm': 14,
	'text-lg': 18,
	'text-2xl': 24,
	'text-4xl': 36,
};
const sizeOf = (classes: string, unit: 'px' | 'vh') => {
	if (unit === 'vh')
		return Number(classes.match(/\btext-\[(\d+(?:\.\d+)?)vh\]/)?.[1]);
	const named = classes.split(/\s+/).find((c) => c in PX);
	return named ? PX[named] : NaN;
};

/** The classes on the first element matching a marker in the rendered HTML. */
function classesOf(html: string, marker: RegExp): string {
	const tag = html.match(marker)?.[0] ?? '';
	return tag.match(/class="([^"]*)"/)?.[1] ?? '';
}

// docs/SPEC.md's legibility budget at the design distance (ADR-0071).
describe('the bike computer reads from the saddle', () => {
	it.each([
		['on a desk', {}, 'px', { value: 36, word: 24 }],
		['on the TV', { tv: true }, 'vh', { value: 5, word: 3 }],
	] as const)('%s', (_, props, unit, floor) => {
		const html = draw({ stats, ...props });
		const value = sizeOf(
			classesOf(html, /<span[^>]*class="num[^"]*"[^>]*>251/),
			unit,
		);
		const unitSize = sizeOf(
			classesOf(html, /<span[^>]*class="text-muted[^"]*font-normal"[^>]*>W</),
			unit,
		);
		const word = sizeOf(
			classesOf(
				html,
				/<span[^>]*class="[^"]*flex items-center[^"]*"[^>]*>Power/,
			),
			unit,
		);
		expect(value).toBeGreaterThanOrEqual(floor.value);
		expect(word).toBeGreaterThanOrEqual(floor.word);
		// A unit is at most half its number's size.
		expect(unitSize).toBeLessThanOrEqual(value / 2);
		if (unit === 'vh') expect(unitSize).toBeGreaterThanOrEqual(2.9);
	});

	it('glows once, on the 3 s power', () => {
		expect(draw({ stats }).match(/glow-text/g)).toHaveLength(1);
		expect(draw({ stats, stale: true })).not.toMatch(/glow-text/);
	});
});

describe('turning the page', () => {
	it('opens on RIDE with a dot per page and the panel to tap', () => {
		const html = draw({ stats });
		expect(html).toMatch(/data-page="ride"/);
		expect(html.match(/data-testid="computer-dot"/g)).toHaveLength(2);
		expect(html).toMatch(
			/aria-current="page"[^>]*aria-label="RIDE page"|aria-label="RIDE page"[^>]*aria-current="page"/,
		);
		expect(html).toMatch(/aria-label="next page, POWER"/);
	});

	it('has one page and nothing to turn without live numbers of its own', () => {
		const html = draw();
		expect(html).not.toMatch(/computer-dot|next page/);
	});

	it('has nothing to tap on the TV, where the keys turn it', () => {
		expect(draw({ stats, tv: true })).not.toMatch(/<button/);
	});
});
