// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { LobbyClientMessage } from '#lib/protocol.ts';

vi.mock('#lib/sound/cues.ts', () => ({ play: () => {} }));
const world = vi.hoisted(() => ({ camera: vi.fn(), photo: vi.fn() }));
vi.mock('#lib/world/ride-view.ts', async (actual) => ({
	...(await actual<typeof import('#lib/world/ride-view.ts')>()),
	askCamera: world.camera,
	askPhoto: world.photo,
}));

import { riderLane } from '#lib/rider-lane.svelte.ts';
import { rideOffers } from './ride-offers.svelte';
import { serveRideRemote } from './ride-remote.svelte';

/** A workout alone, as much of one as the remote reads. */
function workout() {
	const s = $state({
		state: 'running',
		held: false,
		bias: 1,
		sim: false,
		gear: { label: '0' },
		workout: {
			name: 'Two blocks',
			steps: [
				{ type: 'steady', seconds: 60, target: 0.6 },
				{ type: 'steady', seconds: 60, target: 0.8 },
			],
		},
		segments: [{}, {}],
		info: { segmentIndex: 0 },
		road: null,
	});
	return Object.assign(s, {
		atEnd: () => false,
		easierHarder: vi.fn(() => ({ moved: true })),
		nudgeBias: vi.fn((step: number) => (s.bias += step)),
		pause: vi.fn(() => (s.held = true)),
		resume: vi.fn(() => (s.held = false)),
		skip: vi.fn(() => (s.info.segmentIndex += 1)),
		extend: vi.fn(),
	});
}

describe('the phone remote of a ride alone (#4425)', () => {
	let sent: LobbyClientMessage[];
	const held = $state<{ session: ReturnType<typeof workout> | null }>({
		session: null,
	});
	let dispose: () => void;

	beforeEach(() => {
		sent = [];
		held.session = null;
		riderLane.reset();
		riderLane.opened((msg) => sent.push(structuredClone(msg)));
		dispose = $effect.root(() =>
			serveRideRemote({
				session: () => held.session as never,
				road: () => null,
			}),
		);
		flushSync();
	});
	afterEach(() => {
		dispose();
		riderLane.claimRide(false, '', '');
	});

	const claims = () => sent.filter((m) => m.ride).map((m) => m.ride!.riding);
	const hear = (action: string) => {
		riderLane.heard({ remote: { action } });
		flushSync();
	};

	it('claims the lane while the ride runs and lets go at its summary', async () => {
		expect(claims().at(-1)).toBe(false);
		const before = claims().length;
		const ride = (held.session = workout());
		flushSync();
		await Promise.resolve();
		expect(claims().slice(before)).toEqual([true]);
		ride.state = 'done';
		flushSync();
		await Promise.resolve();
		expect(claims().slice(before)).toEqual([true, false]);
	});

	it('runs the phone’s presses on the ride and answers them', () => {
		const ride = (held.session = workout());
		flushSync();
		sent = [];

		hear('harder');
		expect(ride.easierHarder).toHaveBeenCalledWith(1);
		hear('pause');
		expect(ride.pause).toHaveBeenCalled();
		expect(sent).toContainEqual({
			pause: { pausable: true, paused: true, blocks: true },
		});
		hear('resume');
		expect(ride.resume).toHaveBeenCalled();
		hear('camera');
		expect(world.camera).toHaveBeenCalled();

		// Skip and +1 min (#4425): the last block's Skip is End ride's.
		sent = [];
		hear('extend');
		expect(ride.extend).toHaveBeenCalledWith(60);
		hear('skip');
		expect(ride.skip).toHaveBeenCalledOnce();
		expect(sent.at(-1)).toEqual({
			pause: { pausable: true, paused: false, blocks: true, last: true },
		});
		hear('skip');
		expect(ride.skip).toHaveBeenCalledOnce();

		sent = [];
		hear('sync');
		expect(sent.some((m) => m.view)).toBe(true);
		expect(sent.some((m) => m.pause)).toBe(true);
	});

	it('runs the now bar’s own controls for the phone, and says what they offer', async () => {
		held.session = workout();
		flushSync();
		const tv = vi.fn(() => (rideOffers.tv = !rideOffers.tv));
		const flag = vi.fn(() => rideOffers.flagged());
		const offs = [
			rideOffers.offer('view-flat', () => {}),
			rideOffers.offer('tv', tv),
			rideOffers.offer('flag', flag),
		];
		try {
			sent = [];
			hear('sync');
			expect(sent.find((m) => m.view)?.view).toMatchObject({
				look: 'flat',
				offers: ['view-flat', 'flag', 'tv'],
			});

			sent = [];
			hear('tv');
			hear('flag');
			expect(tv).toHaveBeenCalledOnce();
			expect(flag).toHaveBeenCalledOnce();
			// Answered once the screen has turned, by the view's own effect.
			await Promise.resolve();
			flushSync();
			expect(sent.filter((m) => m.view).at(-1)?.view).toMatchObject({
				tv: true,
				flags: 1,
			});

			// A control the bar does not draw does nothing from the phone.
			hear('end');
			hear('view-map');
		} finally {
			offs.forEach((off) => off());
			rideOffers.reset();
		}
	});

	it('says nothing and runs nothing once no ride runs', () => {
		const ride = (held.session = workout());
		ride.state = 'done';
		flushSync();
		sent = [];
		hear('pause');
		expect(ride.pause).not.toHaveBeenCalled();
		expect(sent.filter((m) => m.pause || m.view)).toEqual([]);
	});
});
