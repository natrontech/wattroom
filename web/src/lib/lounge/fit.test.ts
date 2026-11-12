import { describe, expect, it } from 'vitest';
import { fitOf, namePx, stageAt, wholeAt } from './fit';
import { FRONT_Y, SAFE_W, SCENE_H, hasFront, middleOf } from './scene';

// The lounge's box in the app, measured (#4537): the window, its screen's
// pixel ratio, the box the room gets, and the room's bar with its 4 px
// off the edge.
const DESKS = [
	['1280 × 800', 2, 1040, 736, 36],
	['1440 × 900', 2, 1200, 836, 36],
	['1728 × 1117', 2, 1488, 1053, 36],
	['2560 × 1440', 1, 2320, 1376, 36],
	['810 × 1000, tall and narrow', 2, 570, 936, 36],
	['1280 × 800 at 125 %', 1.25, 1040, 736, 36],
	['1280 × 800, riding', 2, 1280, 582, 32],
	['1440 × 900, riding', 2, 1440, 667, 32],
	['1728 × 1117, riding', 2, 1728, 851, 32],
	['2560 × 1440, riding', 1, 2560, 1126, 32],
	['810 × 1000, riding', 2, 810, 666, 32],
] as const;

describe('the lounge in its box', () => {
	it.each(DESKS)('shows the whole room at %s', (_, dpr, w, h, bar) => {
		const s = fitOf(w, h, dpr, bar);
		const rows = Math.floor(h / s);
		const { oy } = middleOf(w / s, rows);
		expect(hasFront(Math.floor(w / s), rows)).toBe(true);
		// The front row's names clear the bar.
		expect((rows - oy - (FRONT_Y + 18)) * s).toBeGreaterThanOrEqual(
			namePx(s) + bar,
		);
		// Nothing clickable is cut off at the sides.
		expect(w / s).toBeGreaterThanOrEqual(SAFE_W);
	});

	it.each(DESKS)('keeps whole screen pixels at %s', (_, dpr, w, h, bar) => {
		const k = fitOf(w, h, dpr, bar) * dpr;
		expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
	});

	it.each(DESKS)('is as big as it can be at %s', (_, dpr, w, h, bar) => {
		const up = fitOf(w, h, dpr, bar) + 1 / dpr;
		expect(w / up >= SAFE_W && wholeAt(h, up, bar)).toBe(false);
	});

	it('grows on a bigger screen', () => {
		expect(fitOf(2320, 1376, 1, 32)).toBeGreaterThan(fitOf(1200, 836, 2, 32));
	});

	it('gives a phone 2 and lets it pan, when its height allows', () => {
		expect(fitOf(390, 727, 3, 60)).toBe(2);
	});

	it('shows the stage alone where nothing shows the whole room', () => {
		const s = fitOf(844, 300, 3, 28);
		expect(wholeAt(300, s, 28)).toBe(false);
		expect(stageAt(300, s, 28)).toBe(true);
	});

	it('leaves a picture on the wall the stage, as before', () => {
		// The stage alone is all a picture on the wall needs: a bigger pixel.
		expect(fitOf(1200, 836, 2, 32, false)).toBeGreaterThan(
			fitOf(1200, 836, 2, 32),
		);
		expect(
			Math.floor(836 / fitOf(1200, 836, 2, 32, false)),
		).toBeGreaterThanOrEqual(SCENE_H);
	});

	it('measures the bar: a wrapped one takes a smaller pixel', () => {
		expect(fitOf(1040, 600, 1, 80)).toBeLessThanOrEqual(
			fitOf(1040, 600, 1, 28),
		);
	});
});
