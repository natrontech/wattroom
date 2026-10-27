// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_ASK, PHOTO_ASK } from '$lib/world/ride-view';
import { createRemoteWorld } from './remote-world';

const rig = () => {
	const cheer = vi.fn();
	let t = 0;
	const world = createRemoteWorld({
		me: () => 'jan',
		cheer,
		deck: () => ['flame', 'clap'],
		now: () => t,
	});
	return { world, cheer, at: (ms: number) => (t = ms) };
};

describe('the remote’s world presses on the holding tab (#4253)', () => {
	const off: (() => void)[] = [];
	afterEach(() => off.splice(0).forEach((f) => f()));
	const listen = (name: string) => {
		const seen = vi.fn((e: Event) => e.preventDefault());
		window.addEventListener(name, seen);
		off.push(() => window.removeEventListener(name, seen));
		return seen;
	};

	it('Camera asks the world to step, naming no camera', () => {
		const seen = listen(CAMERA_ASK);
		rig().world.actions.camera();
		expect(seen).toHaveBeenCalledOnce();
		expect((seen.mock.calls[0][0] as CustomEvent).detail ?? null).toBeNull();
	});

	it('Photo asks the world for the picture', () => {
		const seen = listen(PHOTO_ASK);
		rig().world.actions.photo();
		expect(seen).toHaveBeenCalledOnce();
	});

	it('Cheer answers the rider who last cheered you, with your first cheer', () => {
		const { world, cheer, at } = rig();
		world.heard([{ emoji: 'clap', fromId: 'mia', to: 'jan' }]);
		at(5000);
		world.actions['cheer-back']();
		expect(cheer).toHaveBeenCalledWith('flame', 'mia');
	});

	it('Cheer cheers everyone when nobody cheered you', () => {
		const { world, cheer } = rig();
		world.actions['cheer-back']();
		expect(cheer).toHaveBeenCalledWith('flame', undefined);
	});
});
