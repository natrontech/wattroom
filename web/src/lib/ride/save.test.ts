import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({ api }));
const account = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/account.svelte', () => ({ account }));

const { uploadRide, recordingUpload } = await import('./save');

const ride = {
	workoutName: 'Openers',
	workoutJson: '{"name":"Openers","steps":[]}',
	startedAt: '2026-09-06T18:00:00.000Z',
	samples: [{ watts: 210, cadence: 88, hr: 0 }],
};

describe('uploadRide', () => {
	it('hands back the saved ride when it is on the account', async () => {
		api.mockResolvedValueOnce({ ok: true, data: { id: 'r-1' } });
		expect(await uploadRide(ride)).toEqual({ saved: { id: 'r-1' } });
		expect(api).toHaveBeenCalledWith('/api/rides', {
			method: 'POST',
			json: ride,
		});
	});

	it("hands back the saved ride's own XP, which the card must show (#3753)", async () => {
		api.mockResolvedValueOnce({ ok: true, data: { id: 'r-1', xp: 82 } });
		expect(await uploadRide(ride)).toEqual({ saved: { id: 'r-1', xp: 82 } });
	});

	it("hands back the server's own words when it does not", async () => {
		// errors.md: what went wrong, why, and what to do — the server already
		// wrote that sentence, so nothing here paraphrases it.
		api.mockResolvedValueOnce({
			ok: false,
			error: {
				error: 'internal_error',
				message: 'That ride could not be saved.',
			},
		});
		expect(await uploadRide(ride)).toEqual({
			failure: { message: 'That ride could not be saved.', final: false },
		});
	});

	it('marks a refusal the server will repeat as final', async () => {
		// A ride under a minute (rides.go) is refused every time it is sent:
		// the buffer must not offer it back, and the words must not promise a
		// retry (#794's recovery card).
		api.mockResolvedValueOnce({
			ok: false,
			error: {
				error: 'validation_error',
				message: 'A ride under a minute is not saved.',
			},
		});
		expect(await uploadRide(ride)).toEqual({
			failure: { message: 'A ride under a minute is not saved.', final: true },
		});
	});

	it('marks a ride overlapping a saved one as final', async () => {
		// The account already holds a ride over those seconds (#3044): a retry
		// is refused the same way, so the card must not keep offering it.
		api.mockResolvedValueOnce({
			ok: false,
			error: {
				error: 'conflict',
				message: 'You already have a ride saved at this time.',
			},
		});
		expect(await uploadRide(ride)).toMatchObject({ failure: { final: true } });
	});
});

// A ride that raised the curve is what makes the server suggest an FTP (and
// an LTHR); `suggestedFtp` rides on /api/me, which nothing re-read after a
// save — so the prompt showed only after a reload or a Home visit, detached
// from the ride that earned it (#2626).
describe('a saved ride', () => {
	it('re-reads the account, and a refused one does not', async () => {
		account.load.mockClear();
		api.mockResolvedValueOnce({ ok: true, data: { id: 'r-2' } });
		await uploadRide(ride);
		expect(account.load).toHaveBeenCalledOnce();

		account.load.mockClear();
		api.mockResolvedValueOnce({
			ok: false,
			error: { error: 'internal_error', message: 'Not now.' },
		});
		await uploadRide(ride);
		expect(account.load).not.toHaveBeenCalled();
	});
});

describe('recordingUpload', () => {
	it("sends a road workout's fractional clock as a whole second", () => {
		const up = recordingUpload({ name: 'Leg', steps: [] }, new Date(0), [
			{
				watts: 100,
				cadence: 80,
				heartRate: 0,
				bias: 1,
				clock: 0.9,
				released: false,
			},
		]);
		expect(up.samples[0].clock).toBe(0);
	});
});

// Jan's 65 minutes on the Pass loop (#4262): a WattRoom road is borrowed and
// has no route row, so a workout on it saves as one on no stored road.
describe('a workout on a WattRoom road', () => {
	it('saves without the loop’s id', async () => {
		const { homeRoad, homeRoute } = await import('$lib/ride/home-roads');
		const { onRoute } = await import('$lib/road/compile');
		const { byId } = await import('$lib/workout/library');
		const pass = await homeRoute(homeRoad('intro')!);
		const workout = onRoute(byId('sweet-spot-2x20')!.workout, pass, 0);
		const second = {
			watts: 200,
			cadence: 90,
			heartRate: 0,
			bias: 1,
			clock: 0,
			released: false,
			m: 5,
			alt: 900,
		};
		const up = recordingUpload(workout, new Date(0), [second], {
			borrowed: pass.borrowed,
		});
		expect(up.routeId).toBeUndefined();
		expect(up.drive).toBeUndefined();
		// The metres still go: the server takes them on no route.
		expect(up.samples[0]).toMatchObject({ m: 5, alt: 900 });
	});
});

describe('a save refused over its road', () => {
	const onRoad = { ...ride, routeId: 'intro', drive: 'ergByRoad' as const };

	it('saves again without the road, and says it was left off', async () => {
		api.mockClear();
		api
			.mockResolvedValueOnce({
				ok: false,
				error: {
					error: 'validation_error',
					message: 'That is not a route id.',
					field: 'routeId',
				},
			})
			.mockResolvedValueOnce({ ok: true, data: { id: 'r-3' } });
		expect(await uploadRide(onRoad)).toEqual({
			saved: { id: 'r-3', roadLeftOff: true },
		});
		expect(api).toHaveBeenLastCalledWith('/api/rides', {
			method: 'POST',
			json: { ...ride, routeId: undefined, drive: undefined },
		});
	});

	it('hands back the second refusal when the ride is refused without it too', async () => {
		api
			.mockResolvedValueOnce({
				ok: false,
				error: {
					error: 'not_found',
					message: 'That route is not one of yours.',
					field: 'routeId',
				},
			})
			.mockResolvedValueOnce({
				ok: false,
				error: {
					error: 'conflict',
					message: 'You already have a ride saved at this time.',
				},
			});
		expect(await uploadRide(onRoad)).toEqual({
			failure: {
				message: 'You already have a ride saved at this time.',
				final: true,
			},
		});
	});
});
