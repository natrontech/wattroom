import { describe, expect, it } from 'vitest';
import { durationSeconds, flatten, targetAt } from './engine';
import { byFocus, byId, focuses, library } from './library';

const FTP = 250;

describe('library', () => {
	it('ships roughly the 25 workouts WATTROOM.md promises', () => {
		expect(library.length).toBeGreaterThanOrEqual(25);
	});

	it('has unique ids', () => {
		const ids = library.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('covers every focus', () => {
		for (const focus of focuses) {
			expect(byFocus(focus).length, `${focus} has no workouts`).toBeGreaterThan(
				0,
			);
		}
	});

	it('every workout has a name, a summary and a positive duration', () => {
		for (const entry of library) {
			expect(entry.workout.name, entry.id).toBeTruthy();
			expect(entry.summary, entry.id).toBeTruthy();
			expect(durationSeconds(entry.workout), entry.id).toBeGreaterThan(0);
		}
	});

	/**
	 * The library is curated content, so the risk is drift rather than crashes: a
	 * "recovery" session quietly containing threshold work is worse than a broken one,
	 * because nobody notices until a rider is cooked on their rest day.
	 *
	 * Bands are docs/SPEC.md's Coggan zones. Sweet spot is the one named band that is
	 * not a Coggan zone — 88–94 % FTP by the standard definition.
	 */
	it('keeps its hardest sustained effort inside the band its focus claims', () => {
		const ceilings: Record<string, number> = {
			Recovery: 0.75, // warmups and openers legitimately touch tempo briefly
			Endurance: 0.9,
			Tempo: 0.9,
			'Sweet spot': 1.05, // over-unders cross FTP on purpose
			Threshold: 1.05,
			'VO₂ max': 1.2,
			Anaerobic: 1.5,
		};

		for (const entry of library) {
			const peak = Math.max(
				...flatten(entry.workout)
					.filter((segment) => segment.kind !== 'sprint')
					.map((segment) =>
						Math.max(segment.fromFraction ?? 0, segment.toFraction ?? 0),
					),
			);
			expect(
				peak,
				`${entry.id} (${entry.focus}) peaks at ${peak}`,
			).toBeLessThanOrEqual(ceilings[entry.focus]);
		}
	});

	it('produces a real ERG target at the start of every workout', () => {
		for (const entry of library) {
			const segments = flatten(entry.workout);
			const { targetWatts } = targetAt(segments, FTP, 0);
			// Sprint-first workouts would legitimately have none; none of ours start that way.
			expect(targetWatts, entry.id).not.toBeNull();
			expect(targetWatts!, entry.id).toBeGreaterThan(0);
		}
	});

	it('finds workouts by id and misses cleanly', () => {
		expect(byId('sweet-spot-2x20')?.workout.name).toBe('Sweet Spot 2×20');
		expect(byId('nope')).toBeUndefined();
	});

	it('orders a focus shortest first, so the easy way in is at the top', () => {
		const durations = byFocus('Sweet spot').map((entry) =>
			durationSeconds(entry.workout),
		);
		expect(durations).toEqual([...durations].sort((a, b) => a - b));
	});
});
