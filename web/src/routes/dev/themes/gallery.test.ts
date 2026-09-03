import { describe, expect, it } from 'vitest';
import { CONTRAST, type Theme } from '$lib/palette';
import { THEMES } from '$lib/themes';
import {
	GALLERY_ROWS,
	GALLERY_THEMES,
	rampReadings,
	readings,
	worstContrast,
} from './gallery';

describe('the gallery shows every theme (#399)', () => {
	// The whole point of the page is that nobody can judge a palette they
	// cannot see. A theme added to the catalogue and missed here is invisible
	// again, and nothing else in the suite would notice.
	it('draws each catalogue theme exactly once', () => {
		expect(GALLERY_THEMES.map((t) => t.id).sort()).toEqual(
			THEMES.map((t) => t.id).sort(),
		);
	});

	it('leaves no theme out of a row', () => {
		const laid = new Set(GALLERY_THEMES.map((t) => t.id));
		const missing = THEMES.filter((t) => !laid.has(t.id)).map((t) => t.name);
		expect(missing, `themes with nowhere to be judged: ${missing}`).toEqual([]);
	});

	it('groups an identity into one row, cave before desk', () => {
		const identities = GALLERY_ROWS.map((row) => row.identity);
		expect(new Set(identities).size).toBe(identities.length);
		for (const row of GALLERY_ROWS) {
			expect(row.panels.every((p) => p.theme.identity === row.identity)).toBe(
				true,
			);
			// Same column, same job, in every row — otherwise two identities
			// are being compared across different surfaces.
			expect(row.panels.map((p) => p.surface)).toEqual(
				[...row.panels]
					.map((p) => p.surface)
					.sort((a, b) => (a === b ? 0 : a === 'cave' ? -1 : 1)),
			);
			expect(row.panels[0].surface).toBe('cave');
		}
	});

	// The dark member is what a ride renders whatever the scheme says
	// (ADR-0005, amended in #113), so the cave column may never be a white one.
	it('never puts a white theme in the cave column', () => {
		for (const row of GALLERY_ROWS)
			for (const panel of row.panels)
				expect(panel.theme.family).toBe(
					panel.surface === 'cave' ? 'dark' : 'white',
				);
	});
});

describe('the contrast numbers beside each theme', () => {
	const outrun = THEMES.find((t) => t.id === 'outrun') as Theme;

	it('reports the gated tokens against the theme it belongs to', () => {
		const report = readings(outrun);
		expect(report.map((r) => r.token)).toEqual([
			'ink',
			'muted',
			'watt',
			'neon',
			'danger',
		]);
		expect(report.find((r) => r.token === 'ink')?.floor).toBe(CONTRAST.text);
		expect(report.find((r) => r.token === 'watt')?.floor).toBe(CONTRAST.accent);
	});

	it('agrees with the build contract every theme already passes', () => {
		for (const theme of THEMES)
			for (const reading of readings(theme))
				expect(
					reading.passes,
					`${theme.name} ${reading.token} at ${reading.ratio.toFixed(2)}:1`,
				).toBe(true);
	});

	it('measures the ramp against the darker of the two surfaces', () => {
		const ramp = rampReadings(outrun);
		expect(ramp).toHaveLength(7);
		expect(ramp[0]).toBeCloseTo(worstContrast(outrun, 'z1'), 5);
	});
});
