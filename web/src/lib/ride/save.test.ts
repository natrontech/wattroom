import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({ api }));

const { uploadRide } = await import('./save');

const ride = {
	workoutName: 'Openers',
	workoutJson: '{"name":"Openers","steps":[]}',
	startedAt: '2026-09-06T18:00:00.000Z',
	samples: [{ watts: 210, cadence: 88, hr: 0 }],
};

describe('uploadRide', () => {
	it('reports nothing to say when the ride is on the account', async () => {
		api.mockResolvedValueOnce({ ok: true, data: {} });
		expect(await uploadRide(ride)).toBe(null);
		expect(api).toHaveBeenCalledWith('/api/rides', {
			method: 'POST',
			json: ride,
		});
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
			message: 'That ride could not be saved.',
			final: false,
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
			message: 'A ride under a minute is not saved.',
			final: true,
		});
	});
});
