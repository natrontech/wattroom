import { describe, expect, it } from 'vitest';
import { fitCPW } from '$lib/road/cpw';
import { createMatchGauge, matchesLeft, matchesLine } from './matches';

// Only 5- and 20-minute bests: W′ = 50·300·1200/900 = 20 kJ, CP = 233⅓ W.
const fallback = fitCPW({ best3m: 0, best12m: 0, best5m: 300, best20m: 250 })!;
const seconds = (n: number, watts: number) =>
	Array.from({ length: n }, () => ({ watts }));

describe('the matches gauge (#3263)', () => {
	it('burns one match per quarter of W′ spent, and none past empty', () => {
		expect(matchesLeft(20_000, 20_000)).toBe(4);
		expect(matchesLeft(15_001, 20_000)).toBe(4);
		expect(matchesLeft(15_000, 20_000)).toBe(3);
		expect(matchesLeft(5_000, 20_000)).toBe(1);
		expect(matchesLeft(0, 20_000)).toBe(0);
		expect(matchesLeft(-3_000, 20_000)).toBe(0);
	});

	it('spends W′ above CP a second at a time', () => {
		const gauge = createMatchGauge(fallback);
		// 100 W over CP spends 100 J a second: the first match goes at 50 s.
		const hard = seconds(49, fallback.cp + 100);
		expect(gauge.feed(hard)).toBe(4);
		expect(gauge.feed([...hard, { watts: fallback.cp + 100 }])).toBe(3);
	});

	it('steps only the new seconds, and starts over with the recording', () => {
		const gauge = createMatchGauge(fallback);
		const ride = seconds(100, fallback.cp + 100);
		expect(gauge.feed(ride)).toBe(2);
		// The same recording again is the same balance, not twice the effort.
		expect(gauge.feed(ride)).toBe(2);
		expect(gauge.feed([])).toBe(4);
	});

	it('gives matches back below CP', () => {
		const gauge = createMatchGauge(fallback);
		const spent = seconds(100, fallback.cp + 100);
		expect(gauge.feed(spent)).toBe(2);
		expect(gauge.feed([...spent, ...seconds(600, 100)])).toBe(4);
	});

	it('says an estimate from 5- and 20-min bests is one', () => {
		expect(fallback.estimate).toBe(true);
		expect(matchesLine(fallback)).toMatch(/estimate/i);
		const fitted = fitCPW({
			best3m: 340,
			best12m: 270,
			best5m: 300,
			best20m: 250,
		});
		expect(matchesLine(fitted)).toBeNull();
	});

	it('hides with a hint when there is no curve to fit', () => {
		const none = fitCPW({ best3m: 0, best12m: 0, best5m: 0, best20m: 0 });
		expect(none).toBeNull();
		expect(matchesLine(none)).toMatch(/5- and 20-min bests/);
	});
});
