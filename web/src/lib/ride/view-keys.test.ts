// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const toggleMap = vi.fn(() => true);
const askViewFlip = vi.fn(() => true);
vi.mock('#lib/session/computer-pages.ts', () => ({
	toggleMap: () => toggleMap(),
}));
const world = { on: true };
const askCamera = vi.fn((_preset?: string) => world.on);
const askPhoto = vi.fn(() => world.on);
vi.mock('#lib/world/ride-view.ts', () => ({
	askViewFlip: () => askViewFlip(),
	askCamera: (preset?: string) => askCamera(preset),
	askPhoto: () => askPhoto(),
}));

const { bindViewKeys, rideKeyOf } = await import('./keys');

const press = (key: string) => {
	const event = new KeyboardEvent('keydown', { key, cancelable: true });
	window.dispatchEvent(event);
	return event.defaultPrevented;
};

describe('the view keys on a session’s and a free ride’s surface (#4236)', () => {
	afterEach(() => vi.clearAllMocks());

	it('reads V as the view flip', () => {
		expect(
			rideKeyOf({
				key: 'v',
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toEqual({ kind: 'view' });
	});

	it('turns to MAP and back, and flips 3D / Flat', () => {
		const off = bindViewKeys(() => false);
		expect(press('m')).toBe(true);
		expect(press('v')).toBe(true);
		off();
		expect(toggleMap).toHaveBeenCalledOnce();
		expect(askViewFlip).toHaveBeenCalledOnce();
	});

	it('takes O and 1-4 for the bar’s Photo and Camera while a world draws', () => {
		const off = bindViewKeys(() => false);
		world.on = true;
		expect(press('o')).toBe(true);
		expect(press('2')).toBe(true);
		expect(askCamera).toHaveBeenCalledWith('heli');
		world.on = false;
		expect(press('o')).toBe(false);
		expect(press('1')).toBe(false);
		off();
		world.on = true;
	});

	it('leaves every other key to whoever has it', () => {
		const off = bindViewKeys(() => false);
		for (const key of ['h', '?', '5']) expect(press(key)).toBe(false);
		off();
	});

	it('yields M to a soundboard pad bound to it', () => {
		const off = bindViewKeys((k) => k === 'm');
		expect(press('m')).toBe(false);
		off();
		expect(toggleMap).not.toHaveBeenCalled();
	});
});
