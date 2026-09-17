// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem } from '$lib/context-menu.svelte';
import type { ServerRide } from './list';
import { rideRowMenu } from './row-menu';

const confirmed = vi.hoisted(() => ({ answer: true, asked: 0 }));
vi.mock('./delete-ride', () => ({
	deleteRideAfterConfirm: async () => {
		confirmed.asked++;
		return confirmed.answer;
	},
}));
const shared = vi.hoisted(() => ({ calls: [] as boolean[] }));
vi.mock('./share', async (original) => ({
	...(await original<typeof import('./share')>()),
	setRideShared: (_ride: ServerRide, next: boolean) => {
		shared.calls.push(next);
	},
}));

const item = (entries: MenuEntry[], label: string): MenuItem =>
	entries.find(
		(entry): entry is MenuItem =>
			entry !== 'separator' && entry.label === label,
	)!;

const ride = (over: Partial<ServerRide> = {}) =>
	({
		id: 'r1',
		workoutName: 'Sweet Spot',
		startedAt: '2026-09-01T06:00:00Z',
		sharedWithFriends: false,
		...over,
	}) as ServerRide;

describe('rideRowMenu (#2171)', () => {
	it('says what pressing it does, not what the ride is (#2167)', () => {
		const first = (entries: MenuEntry[]) =>
			entries[0] === 'separator' ? '—' : entries[0].label;
		expect(first(rideRowMenu(ride()))).toBe('Share with friends');
		expect(first(rideRowMenu(ride({ sharedWithFriends: true })))).toBe(
			'Make private',
		);
	});

	it('flips the ride the other way', () => {
		item(rideRowMenu(ride()), 'Share with friends').onSelect();
		expect(shared.calls).toEqual([true]);
	});

	it('tells the list only about a ride that is actually gone', async () => {
		const gone = vi.fn();
		confirmed.answer = false;
		item(rideRowMenu(ride(), gone), 'Delete ride').onSelect();
		await vi.waitFor(() => expect(confirmed.asked).toBe(1));
		expect(gone).not.toHaveBeenCalled();

		confirmed.answer = true;
		item(rideRowMenu(ride(), gone), 'Delete ride').onSelect();
		await vi.waitFor(() => expect(gone).toHaveBeenCalledOnce());
	});
});
