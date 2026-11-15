// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveredRide } from './recovered';

const state = vi.hoisted(() => ({
	me: { id: 'ana' } as { id: string } | null,
	rides: [] as RecoveredRide[],
	answers: [] as Array<
		{ saved: { id: string } } | { failure: { message: string; final: boolean } }
	>,
	uploads: [] as unknown[],
	discarded: [] as string[],
	toasts: [] as unknown[],
	removed: [] as string[],
}));
vi.mock('#lib/account.svelte.ts', () => ({
	account: {
		get me() {
			return state.me;
		},
	},
}));
vi.mock('#lib/ride/buffer.ts', () => ({
	unfinishedRides: async () =>
		state.rides.filter((r) => !state.discarded.includes(r.rideId)),
	discardRide: async (id: string) => void state.discarded.push(id),
	refuseRide: async (id: string, message: string) => {
		const ride = state.rides.find((r) => r.rideId === id);
		if (ride) ride.refused = message;
	},
}));
vi.mock('#lib/ride/save.ts', () => ({
	uploadRide: async (ride: unknown) => {
		state.uploads.push(ride);
		return state.answers.shift() ?? { saved: { id: 'saved' } };
	},
	toastSaved: (saved: unknown) => void state.toasts.push(saved),
}));
vi.mock('#lib/history.svelte.ts', () => ({
	createHistoryStore: () => ({
		remove: (id: string) => void state.removed.push(id),
	}),
}));

const { outbox } = await import('./outbox.svelte');

const ride = (rideId: string, over: Partial<RecoveredRide> = {}) =>
	({
		rideId,
		ownerId: 'ana',
		startedAt: 1_000,
		workoutName: 'Free ride',
		workoutJson: '{"name":"Free ride","unscored":true,"steps":[]}',
		samples: Array.from({ length: 60 }, (_, i) => ({
			seq: i + 1,
			watts: 200,
			cadence: 90,
			heartRate: 0,
			at: i * 1000,
		})),
		...over,
	}) satisfies RecoveredRide;

beforeEach(() => {
	state.me = { id: 'ana' };
	state.rides = [];
	state.answers = [];
	state.uploads = [];
	state.discarded = [];
	state.toasts = [];
	state.removed = [];
	vi.stubGlobal('navigator', {
		locks: {
			request: (
				_: string,
				_opts: unknown,
				work: (lock: object) => Promise<void>,
			) => work({}),
		},
	});
});

// #4600: a ride kept on the device waited for the rider to find its card.
describe('the outbox', () => {
	it('sends a kept ride, takes it off the device and says so', async () => {
		state.rides = [ride('a', { startedAt: 1234 })];
		await outbox.run();
		expect(state.uploads).toHaveLength(1);
		expect(state.discarded).toEqual(['a']);
		// A workout alone's device summary goes with it.
		expect(state.removed).toEqual(['1234']);
		expect(state.toasts).toEqual([{ id: 'saved' }]);
	});

	it('lets the card still showing the ride say it, instead of a toast', async () => {
		state.rides = [ride('a'), ride('b')];
		const off = outbox.claim((id) => id === 'a');
		await outbox.run();
		off();
		expect(state.toasts).toHaveLength(1);
	});

	it('stops at the first ride the server cannot take, and asks again later', async () => {
		vi.useFakeTimers();
		try {
			state.rides = [ride('a'), ride('b')];
			state.answers = [
				{ failure: { message: 'The server is not reachable.', final: false } },
			];
			await outbox.run();
			expect(state.uploads).toHaveLength(1);
			expect(state.discarded).toEqual([]);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(state.discarded).toEqual(['a', 'b']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('never sends a ride the server refused for good again, even after a reload', async () => {
		state.rides = [ride('refused'), ride('fine')];
		state.answers = [{ failure: { message: 'Overlaps a ride.', final: true } }];
		await outbox.run();
		await outbox.run();
		expect(state.discarded).toEqual(['fine']);
		expect(state.uploads).toHaveLength(2);
	});

	it("never files a ride that is not the signed-in rider's", async () => {
		state.rides = [
			ride('ben', { ownerId: 'ben' }),
			ride('nobody', { ownerId: undefined }),
			ride('unsaveable', { workoutJson: undefined }),
		];
		await outbox.run();
		expect(state.uploads).toEqual([]);
	});

	it('does nothing while nobody is signed in', async () => {
		state.me = null;
		state.rides = [ride('a')];
		await outbox.run();
		expect(state.uploads).toEqual([]);
	});
});
