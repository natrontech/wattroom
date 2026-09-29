import { describe, expect, it } from 'vitest';
import { createLiveStats } from './live-stats.svelte';
import { NP_MIN_SECONDS, normalizedPower, zoneSeconds } from './stats';

const FTP = 250;

/**
 * A ride that moves: a seeded walk through every zone, with coasting seconds.
 * It opens on a 30 s sprint, so NormPower's first window weighs enough that
 * losing it moves the rounded watt.
 */
function ride(seconds: number): number[] {
	let seed = 7;
	return Array.from({ length: seconds }, (_, i) => {
		if (i < 30) return 900;
		seed = (seed * 1103515245 + 12345) % 2 ** 31;
		const w = seed % 480;
		return w < 30 ? 0 : w;
	});
}

function lastAverage(watts: number[], k: number): number {
	const tail = watts.slice(-k);
	return Math.round(tail.reduce((a, b) => a + b, 0) / tail.length);
}

// The live number and the summary's must be one number (#3068): the summary
// is stats.ts over the samples, so the live module has to land on the same
// watt either side of the 20 minutes where NormPower changes formula.
describe('live stats agree with stats.ts', () => {
	it.each([
		['19:59', NP_MIN_SECONDS - 1],
		['20:01', NP_MIN_SECONDS + 1],
	])('at %s', (_, seconds) => {
		const watts = ride(seconds);
		const live = createLiveStats(() => FTP);
		for (const w of watts) live.push({ watts: w });
		const samples = watts.map((w) => ({ watts: w }));
		const now = live.current;

		expect(now.seconds).toBe(seconds);
		expect(now.normPower).toBe(normalizedPower(samples));
		expect(now.zoneSeconds).toEqual(zoneSeconds(samples, FTP));
		expect(now.kj).toBe(Math.round(watts.reduce((a, b) => a + b, 0) / 1000));
		expect(now.power3).toBe(lastAverage(watts, 3));
		expect(now.power10).toBe(lastAverage(watts, 10));
		expect(now.power30).toBe(lastAverage(watts, 30));
		expect(now.intensity).toBe(now.normPower / FTP);
		expect(now.load).toBeCloseTo(
			(now.normPower / FTP) ** 2 * (seconds / 3600) * 100,
			10,
		);
	});

	it('takes the rolling formula past 20 minutes, not the average', () => {
		const watts = ride(NP_MIN_SECONDS + 1);
		const live = createLiveStats(() => FTP);
		for (const w of watts) live.push({ watts: w });
		expect(live.current.normPower).toBeGreaterThan(
			lastAverage(watts, watts.length),
		);
	});
});

describe('createLiveStats', () => {
	it('averages what it has before a window fills', () => {
		const live = createLiveStats(() => FTP);
		live.push({ watts: 100 });
		live.push({ watts: 200 });
		expect(live.current.power3).toBe(150);
		expect(live.current.power30).toBe(150);
	});

	it('scores an hour exactly at FTP as a Load of 100', () => {
		const live = createLiveStats(() => FTP);
		for (let s = 0; s < 3600; s++) live.push({ watts: FTP });
		expect(live.current.intensity).toBe(1);
		expect(live.current.load).toBeCloseTo(100, 10);
	});

	it('starts the block over on a new block and scores only targeted seconds', () => {
		const live = createLiveStats(() => FTP);
		live.push({ watts: 300, block: 0 });
		live.push({ watts: 100, block: 1 });
		expect(live.current.blockAverage).toBe(100);
		expect(live.current.blockExecution).toBeNull();
		// A 100 W target takes SPEC's ±10 W floor, not ±5 W.
		live.push({ watts: 109, block: 1, target: 100 });
		live.push({ watts: 111, block: 1, target: 100 });
		expect(live.current.blockAverage).toBe(107);
		expect(live.current.blockExecution).toBe(0.5);
	});

	it('forgets the ride on reset', () => {
		const live = createLiveStats(() => FTP);
		for (const w of ride(90)) live.push({ watts: w, block: 2, target: 200 });
		live.reset();
		live.push({ watts: 120 });
		expect(live.current.seconds).toBe(1);
		expect(live.current.power30).toBe(120);
		expect(live.current.normPower).toBe(120);
		expect(live.current.blockExecution).toBeNull();
	});
});
