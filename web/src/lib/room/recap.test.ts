import { describe, expect, it } from 'vitest';
import { recapBars, recapSummary } from './recap';
import type { SessionRecap } from '$lib/protocol';

const START = Date.UTC(2026, 8, 7, 19, 4);
const END = START + 67 * 60_000; // 1 h 07 m

function session(
	riders: {
		id: string;
		rider: string;
		from: number;
		to: number;
		rode: boolean;
	}[],
): SessionRecap {
	return {
		id: 'rec-1',
		workout: 'Sweet Spot 3×12',
		startedAt: START,
		endedAt: END,
		riders,
	};
}

describe('recapBars', () => {
	it('draws a rider who was there the whole way across the whole track', () => {
		const [jan] = recapBars(
			session([{ id: 'u1', rider: 'Jan', from: START, to: END, rode: true }]),
		);
		expect(jan.left).toBe(0);
		expect(jan.width).toBe(100);
		expect(jan.stayed).toBe('1 h 07');
	});

	it('starts a late arrival where they arrived', () => {
		// A third of the way in — the case the bars exist to make readable.
		const third = START + (END - START) / 3;
		const [kim] = recapBars(
			session([{ id: 'u2', rider: 'Kim', from: third, to: END, rode: true }]),
		);
		expect(Math.round(kim.left)).toBe(33);
		expect(Math.round(kim.width)).toBe(67);
	});

	it('never lets a bar run past the end of its track', () => {
		// A clock skew, or a rider still present as the row was written: the
		// bar is clamped rather than overflowing the row.
		const [late] = recapBars(
			session([
				{
					id: 'u3',
					rider: 'Ana',
					from: END - 60_000,
					to: END + 600_000,
					rode: false,
				},
			]),
		);
		expect(late.left + late.width).toBeLessThanOrEqual(100);
	});

	it('says "< 1 min" rather than "0 min" beside a bar that is visibly there', () => {
		const [flash] = recapBars(
			session([
				{
					id: 'u4',
					rider: 'Sara',
					from: START,
					to: START + 12_000,
					rode: false,
				},
			]),
		);
		expect(flash.stayed).toBe('< 1 min');
	});

	it('keeps a very short visit visible', () => {
		const [flash] = recapBars(
			session([
				{
					id: 'u4',
					rider: 'Sara',
					from: START,
					to: START + 5_000,
					rode: false,
				},
			]),
		);
		expect(flash.width).toBeGreaterThan(0);
	});

	it('clamps a rider who was here before the timeline started', () => {
		const [early] = recapBars(
			session([
				{
					id: 'u5',
					rider: 'Marco',
					from: START - 600_000,
					to: END,
					rode: true,
				},
			]),
		);
		expect(early.left).toBe(0);
	});

	it('carries who rode and who only watched', () => {
		const bars = recapBars(
			session([
				{ id: 'u1', rider: 'Jan', from: START, to: END, rode: true },
				{ id: 'u6', rider: 'Ana', from: START, to: END, rode: false },
			]),
		);
		expect(bars.map((b) => b.rode)).toEqual([true, false]);
	});
});

describe('recapSummary', () => {
	it('counts the riders and the session', () => {
		expect(
			recapSummary(
				session([
					{ id: 'u1', rider: 'Jan', from: START, to: END, rode: true },
					{ id: 'u2', rider: 'Kim', from: START, to: END, rode: true },
				]),
			),
		).toBe('2 riders · 1 h 07');
	});

	it('says rider, not riders, when one person rode alone', () => {
		expect(
			recapSummary(
				session([{ id: 'u1', rider: 'Jan', from: START, to: END, rode: true }]),
			),
		).toBe('1 rider · 1 h 07');
	});
});
