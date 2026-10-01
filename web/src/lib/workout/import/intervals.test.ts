// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	importPlanned,
	intervalsAvailable,
	openPull,
	PULL_OUTCOMES,
} from './intervals';

// A hand-written planned workout (AGENTS.md: no real payload in a fixture).
const zwo =
	'<workout_file><name>Tempo Tuesday</name><workout>' +
	'<SteadyState Duration="600" Power="0.75"/></workout></workout_file>';

function answer(status: number, body: unknown) {
	return vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			}),
	);
}

describe('the intervals.icu pull (#2327)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('offers the pull only where the server has a client', async () => {
		vi.stubGlobal('fetch', answer(200, { available: false }));
		expect(await intervalsAvailable()).toBe(false);
		vi.stubGlobal('fetch', answer(200, { available: true }));
		expect(await intervalsAvailable()).toBe(true);
		vi.stubGlobal('fetch', answer(500, { error: 'internal_error' }));
		expect(await intervalsAvailable()).toBe(false);
	});

	it('says why a pull came back empty-handed, without asking the server', async () => {
		const fetch = answer(200, {});
		vi.stubGlobal('fetch', fetch);
		for (const [landing, sentence] of Object.entries(PULL_OUTCOMES))
			expect(await openPull(landing)).toEqual({ ok: false, error: sentence });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('opens a pull once, and says so when it is gone', async () => {
		vi.stubGlobal(
			'fetch',
			answer(200, {
				workouts: [{ name: 'Tempo', date: '2026-10-01', zwo }],
				skipped: 1,
			}),
		);
		expect(await openPull('abc')).toEqual({
			ok: true,
			workouts: [{ name: 'Tempo', date: '2026-10-01', zwo }],
			skipped: 1,
		});
		vi.stubGlobal(
			'fetch',
			answer(404, {
				error: 'not_found',
				message: 'That pull has expired or was already opened. Pull again.',
			}),
		);
		expect(await openPull('abc')).toEqual({
			ok: false,
			error: 'That pull has expired or was already opened. Pull again.',
		});
	});

	it('converts a planned workout as the .zwo it is, whatever its name', () => {
		const outcome = importPlanned(
			{ name: 'Over/unders 3/2', date: '2026-10-01', zwo },
			250,
		);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) expect(outcome.imported.workout.steps).toHaveLength(1);
		// Not a .zwo at all: the importer's own refusal, not a crash.
		const broken = importPlanned({ name: 'x', date: '', zwo: 'not xml' }, 250);
		expect(broken.ok).toBe(false);
	});
});
