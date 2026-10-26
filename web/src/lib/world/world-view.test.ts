// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorldMode, worldMode } from './mode';

const cues = vi.hoisted(() => [] as string[]);
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => cues.push(id) }));
import { createWorldView } from './world-view.svelte';

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
		cues.length = 0;
		localStorage.clear();
		capable();
		at(900);
	});
	afterEach(() => vi.restoreAllMocks());

	it('rides Flat until the rider turns 3D on, and 3D turns it on (#3084)', () => {
		const view = createWorldView();
		expect(view.on).toBe(false);
		expect(view.reason).toBe('chosen');
		view.retry();
		expect(view.on).toBe(true);
		expect(worldMode()).toBe('full');
		expect(createWorldView().on).toBe(true);
	});

	it('switches mid-ride both ways, and each switch is the rider’s choice (#3084)', () => {
		setWorldMode('steady');
		const view = createWorldView();
		expect(view.on).toBe(true);
		view.flatten();
		expect(view.on).toBe(false);
		expect(worldMode()).toBe('flat');
		view.retry();
		expect(view.on).toBe(true);
		expect(worldMode()).toBe('full');
	});

	it('keeps a world the old /dev/world flag turned on, once (#3084)', () => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		expect(createWorldView().on).toBe(true);
		expect(localStorage.getItem('wattroom.world-slot.v1')).toBeNull();
		expect(worldMode()).toBe('full');
	});

	it('falls back one way, and only "Try 3D again" brings the world back', () => {
		setWorldMode('full');
		const view = createWorldView();
		expect(view.on).toBe(true);
		view.fail('frames');
		expect(view.reason).toBe('frames');
		view.retry();
		expect(view.on).toBe(true);
		expect(worldMode()).toBe('full'); // a failure mended changes no choice
	});

	it('takes the flat road from the world’s menu, and remembers it on this device', () => {
		setWorldMode('full');
		const view = createWorldView();
		view.flatten();
		expect(view.reason).toBe('chosen');
		expect(worldMode()).toBe('flat');
		expect(createWorldView().reason).toBe('chosen');
	});

	it('rides flat while the window is too short for its panels, and comes back as it grows (#3668)', () => {
		setWorldMode('full');
		const view = createWorldView();
		try {
			at(720);
			expect(view.on).toBe(false);
			expect(view.reason).toBe('short');
			at(900);
			expect(view.on).toBe(true);
			expect(worldMode()).toBe('full'); // the window chose nothing for the rider
		} finally {
			at(900);
		}
	});

	it('opens on Flat under reduced motion, and one tap lands on Steady (#3214)', async () => {
		const { prefersReducedMotion } = await import('$lib/motion');
		vi.spyOn(prefersReducedMotion, 'current', 'get').mockReturnValue(true);
		const view = createWorldView();
		expect(view.reason).toBe('motion');
		view.retry();
		expect(view.on).toBe(true);
		expect(worldMode()).toBe('steady');
		expect(view.look).toBe('steady');
	});

	it('makes "Try 3D again" the rider’s new choice when their own choice held it flat', () => {
		setWorldMode('flat');
		const view = createWorldView();
		view.retry();
		expect(view.on).toBe(true);
		expect(worldMode()).toBe('full');
	});

	// Last: it loads fresh modules, which the tests above must not share.
	it('offers no 3D to a browser that cannot draw it', async () => {
		vi.restoreAllMocks();
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
		// What the browser can draw is asked once a page: a fresh module asks again.
		vi.resetModules();
		const fresh = await import('./world-view.svelte');
		setWorldMode('full');
		expect(fresh.createWorldView().reason).toBe('capability');
	});

	it('sounds a fallback once, and nothing for the rider’s own Flat (#4217)', () => {
		setWorldMode('full');
		const view = createWorldView();
		view.flatten();
		expect(cues).toEqual([]);
		view.retry();
		view.fail('frames');
		view.fail('context-lost');
		expect(cues).toEqual(['fault']);
	});
});
