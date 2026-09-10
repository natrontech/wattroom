import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveredRide } from './recovered';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('$lib/confirm.svelte', () => ({ confirm: mocks.confirm }));

const { confirmDiscard, discardBody, recordedMinutes } =
	await import('./recovered');

const ride = (samples: number, workoutJson = '{}'): RecoveredRide =>
	({
		rideId: 'r1',
		workoutName: 'Sweet Spot',
		workoutJson,
		startedAt: 1_700_000_000_000,
		samples: Array.from({ length: samples }, () => ({ watts: 200 })),
	}) as unknown as RecoveredRide;

beforeEach(() => mocks.confirm.mockReset());

describe('recordedMinutes', () => {
	it('is the card’s own arithmetic, in one place', () => {
		expect(recordedMinutes(ride(2520))).toBe(42);
	});
});

describe('discardBody', () => {
	// errors.md: what happens, why, what to do. The "why" is that this device
	// holds the only copy; the "what to do" is the two buttons beside it.
	it('names the ride, that this is the only copy, and the ways to keep it', () => {
		const body = discardBody(ride(2520));
		expect(body).toMatch(/“Sweet Spot”, 42 min recorded/);
		expect(body).toMatch(/on this device and nowhere else/);
		expect(body).toMatch(/only copy/);
		expect(body).toMatch(/Save it to your account or download the \.fit/);
	});

	// The card hides "Save to your account" for a ride buffered before #794,
	// which carries no workout JSON — so the copy must not name that button.
	it('offers only the .fit when there is no workout to save', () => {
		const body = discardBody(ride(2520, ''));
		expect(body).toMatch(/Download the \.fit first if you want to keep it/);
		expect(body).not.toMatch(/Save it to your account/);
	});
});

describe('confirmDiscard', () => {
	it('asks with the house pair and passes a refusal on (#1493)', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await confirmDiscard(ride(60))).toBe(false);
		const ask = mocks.confirm.mock.calls[0][0];
		expect(ask.title).toBe('Discard the recovered ride?');
		expect(ask.action).toBe('Discard it');
		expect(ask.cancel).toBe('Keep it');
	});

	it('passes a yes on', async () => {
		mocks.confirm.mockResolvedValue(true);
		expect(await confirmDiscard(ride(60))).toBe(true);
	});
});
