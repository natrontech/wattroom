// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorldSlot } from './flag';
import { createWorldView, flatRoad, setFlatRoad } from './world-view.svelte';

/** A browser that draws the world: WebGL2 and WEBGL_multi_draw. */
function capable() {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		getExtension: () => ({ loseContext() {} }),
	} as unknown as WebGL2RenderingContext);
}

/** The window's height, as a resize says it (happy-dom's own is 768). */
const at = (height: number) => {
	Object.defineProperty(window, 'innerHeight', {
		value: height,
		configurable: true,
	});
	window.dispatchEvent(new Event('resize'));
};

describe('a ride’s world view (#3080)', () => {
	beforeEach(() => {
		localStorage.clear();
		capable();
		at(900);
	});
	afterEach(() => vi.restoreAllMocks());

	it('keeps the slots where this device has no world slot', () => {
		const view = createWorldView();
		expect(view.on).toBe(false);
		expect(view.reason).toBeNull();
	});

	it('falls back one way, and only "Try 3D again" brings the world back', () => {
		setWorldSlot(true);
		const view = createWorldView();
		expect(view.on).toBe(true);
		view.fail('frames');
		expect(view.reason).toBe('frames');
		view.retry();
		expect(view.on).toBe(true);
		expect(flatRoad()).toBeNull(); // a failure mended is no choice made
	});

	it('takes the flat road from the world’s menu, and remembers it on this device', () => {
		setWorldSlot(true);
		const view = createWorldView();
		view.flatten();
		expect(view.reason).toBe('chosen');
		expect(flatRoad()).toBe(true);
		expect(createWorldView().reason).toBe('chosen');
	});

	it('rides flat while the window is too short for its panels, and comes back as it grows (#3668)', () => {
		setWorldSlot(true);
		const view = createWorldView();
		try {
			at(720);
			expect(view.on).toBe(false);
			expect(view.reason).toBe('short');
			at(900);
			expect(view.on).toBe(true);
			expect(flatRoad()).toBeNull(); // the window chose nothing for the rider
		} finally {
			at(900);
		}
	});

	it('makes "Try 3D again" the rider’s new choice when their own choice held it flat', () => {
		setWorldSlot(true);
		setFlatRoad(true);
		const view = createWorldView();
		view.retry();
		expect(view.on).toBe(true);
		expect(flatRoad()).toBe(false);
	});
});
