// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MaxLegSeconds } from '$lib/protocol';
import type { TrackPoint } from '$lib/road/parse';
import { toGpx } from '$lib/road/fixtures';
import { base64Of, importRoute, isRouteFile, readRouteFile } from './index';

// Invented, in the South Atlantic: no fixture here is anyone's road (#3054).
const M_PER_DEG = (Math.PI / 180) * 6371008.8;
function eastward(
	lengthM: number,
	stepM: number,
	height: (s: number) => number = () => 100,
): TrackPoint[] {
	const perLon = M_PER_DEG * Math.cos((30 * Math.PI) / 180);
	return Array.from({ length: Math.round(lengthM / stepM) + 1 }, (_, i) => ({
		lat: -30,
		lon: -25 + (i * stepM) / perLon,
		ele: height(i * stepM),
	}));
}

describe('importRoute', () => {
	it('makes a clean file into a road with nothing to fix', () => {
		const outcome = importRoute(toGpx(eastward(5000, 10)));
		if (!outcome.ok || !('imported' in outcome))
			throw new Error(JSON.stringify(outcome));
		const { imported } = outcome;
		expect(imported.src).toBe('gpx');
		expect(imported.eleSource).toBe('file');
		expect(imported.fixes).toEqual([]);
		expect(imported.route.name).toMatch(/^Road · 5\.0 km/);
		expect(imported.legs).toBe(1);
		// 5 km on the flat at 225 W: somewhere near nine minutes.
		expect(imported.referenceSeconds).toBeGreaterThan(420);
		expect(imported.referenceSeconds).toBeLessThan(660);
	});

	it('says what it fixed, in plain words', () => {
		const wall = (s: number) =>
			100 + Math.min(Math.max(s - 1000, 0), 300) * 0.3;
		const outcome = importRoute(toGpx(eastward(3000, 10, wall)));
		if (!outcome.ok) throw new Error(JSON.stringify(outcome));
		expect(outcome.imported.fixes.join(' ')).toMatch(/held to −15 … \+20 %/);
	});

	it('asks which track when a file carries several, then rides the one picked', () => {
		const gpx = toGpx(eastward(3000, 10)).replace(
			'</trk>',
			`</trk>${toGpx(eastward(4000, 10, () => 300)).match(/<trk>[\s\S]*<\/trk>/)![0]}`,
		);
		const first = importRoute(gpx);
		expect(first).toEqual({
			ok: false,
			tracks: [
				expect.stringMatching(/^Track 1 · 3\.0 km$/),
				expect.stringMatching(/^Track 2 · 4\.0 km$/),
			],
		});
		const picked = importRoute(gpx, { track: 1 });
		if (!picked.ok) throw new Error(JSON.stringify(picked));
		expect(picked.imported.route.name).toMatch(/^Road · 4\.0 km/);
	});

	it('asks before riding a file with no heights, and rides it flat when told to', () => {
		const gpx = toGpx(eastward(3000, 10)).replace(/<ele>[^<]*<\/ele>/g, '');
		expect(importRoute(gpx)).toEqual({ ok: false, noHeights: true });
		const flat = importRoute(gpx, { flat: true });
		if (!flat.ok) throw new Error(JSON.stringify(flat));
		expect(flat.imported.eleSource).toBe('none');
		expect(flat.imported.fixes).toContain(
			'The file carries no heights, so the road is flat.',
		);
	});

	it('refuses a route under 2 km, saying so', () => {
		const outcome = importRoute(toGpx(eastward(1500, 10)));
		expect(outcome.ok).toBe(false);
		if (!outcome.ok && 'error' in outcome)
			expect(outcome.error).toMatch(/at least 2 km/);
	});

	it('cuts a route longer than a sitting at the reference pace into legs', () => {
		// 60 km at 10 %: the reference rider is far past six hours.
		const climb = (s: number) => 100 + 0.1 * s;
		const outcome = importRoute(toGpx(eastward(60_000, 20, climb)));
		if (!outcome.ok) throw new Error(JSON.stringify(outcome));
		expect(outcome.imported.referenceSeconds).toBeGreaterThan(MaxLegSeconds);
		expect(outcome.imported.legs).toBe(
			Math.ceil(outcome.imported.referenceSeconds / MaxLegSeconds),
		);
		expect(outcome.imported.legs).toBeGreaterThan(1);
	});

	it('keeps a Strava file’s source, so it rides owner-only', () => {
		const outcome = importRoute(toGpx(eastward(3000, 10), 'StravaGPX'));
		if (!outcome.ok) throw new Error(JSON.stringify(outcome));
		expect(outcome.imported.src).toBe('stravagpx');
	});
});

describe('route files at the door', () => {
	it('tells a route file from a workout file', () => {
		expect(isRouteFile('Loop.GPX')).toBe(true);
		expect(isRouteFile('ride.tcx')).toBe(true);
		expect(isRouteFile('plan.zwo')).toBe(false);
	});

	it('refuses a route file past its ceiling before reading it', async () => {
		const big = {
			name: 'huge.gpx',
			size: 6 << 20,
			text: () => Promise.reject(new Error('should not be read')),
		} as unknown as File;
		const outcome = await readRouteFile(big);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toMatch(/at most 5 MB/);
	});

	it('writes a road’s bytes as the base64 the server reads', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255]);
		expect(
			Uint8Array.from(atob(base64Of(bytes)), (c) => c.charCodeAt(0)),
		).toEqual(bytes);
	});
});
