import { describe, expect, it } from 'vitest';
import RECORDS from '#lib/lounge/records.json';
import { recordAt } from '#lib/lounge/records.ts';

const NOW = 1_793_750_400;

describe('house radio records', () => {
	it('lists only CC0 tracks with a source and a length', () => {
		for (const r of RECORDS) {
			expect(r.licence).toBe('CC0 1.0');
			expect(r.url).toMatch(/^https:\/\/freemusicarchive\.org\//);
			expect(r.file).toMatch(/^[a-z0-9-]+\.mp3$/);
			expect(r.ms).toBeGreaterThan(60_000);
		}
		expect(new Set(RECORDS.map((r) => r.file)).size).toBe(RECORDS.length);
	});

	it('plays the same second on every screen of a crew', () => {
		expect(recordAt('crew-a', NOW + 0.5)).toEqual(
			recordAt('crew-a', NOW + 0.5),
		);
	});

	it('runs on through a record, then moves to the next', () => {
		const first = recordAt('crew-a', NOW);
		const left = first.record.ms / 1000 - first.at;
		expect(recordAt('crew-a', NOW + left / 2).record).toBe(first.record);
		expect(recordAt('crew-a', NOW + left / 2).at).toBeCloseTo(
			first.at + left / 2,
		);
		expect(recordAt('crew-a', NOW + left + 3).record).not.toBe(first.record);
	});

	it('plays every record once a lap', () => {
		const heard = new Set<string>();
		const lap = RECORDS.reduce((s, r) => s + r.ms / 1000 + 2, 0);
		const start = Math.ceil(NOW / lap) * lap;
		for (let t = start; t < start + lap; t += 20)
			heard.add(recordAt('crew-a', t).record.file);
		expect(heard.size).toBe(RECORDS.length);
	});

	it('gives two crews their own order', () => {
		const a = Array.from(
			{ length: 8 },
			(_, i) => recordAt('crew-a', NOW + i * 200).record.file,
		);
		const b = Array.from(
			{ length: 8 },
			(_, i) => recordAt('crew-b', NOW + i * 200).record.file,
		);
		expect(a).not.toEqual(b);
	});
});
