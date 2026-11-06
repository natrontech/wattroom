// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { LobbyClientMessage } from '$lib/protocol';

vi.mock('$lib/sound/cues', () => ({ play: () => {} }));
const world = vi.hoisted(() => ({ camera: vi.fn(), photo: vi.fn() }));
vi.mock('$lib/world/ride-view', () => ({
	askCamera: world.camera,
	askPhoto: world.photo,
	askViewFlip: () => true,
}));

import { riderLane } from '$lib/rider-lane.svelte';
import { serveRideRemote } from './ride-remote.svelte';

/** A workout alone, as much of one as the remote reads. */
function workout() {
	const s = $state({
		state: 'running',
		held: false,
		bias: 1,
		sim: false,
		gear: { label: '0' },
	});
	return Object.assign(s, {
		atEnd: () => false,
		easierHarder: vi.fn(() => ({ moved: true })),
		nudgeBias: vi.fn((step: number) => (s.bias += step)),
		pause: vi.fn(() => (s.held = true)),
		resume: vi.fn(() => (s.held = false)),
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
		expect(sent).toContainEqual({ pause: { pausable: true, paused: true } });
		hear('resume');
		expect(ride.resume).toHaveBeenCalled();
		hear('camera');
		expect(world.camera).toHaveBeenCalled();

		sent = [];
		hear('sync');
		expect(sent.some((m) => m.view)).toBe(true);
		expect(sent.some((m) => m.pause)).toBe(true);
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
