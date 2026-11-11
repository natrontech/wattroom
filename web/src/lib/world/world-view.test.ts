// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorldMode, worldMode } from './mode';

const cues = vi.hoisted(() => [] as string[]);
vi.mock('#lib/sound/cues.ts', () => ({ play: (id: string) => cues.push(id) }));
import { createWorldView, HELD_S, RETURN_S } from './world-view.svelte';

/** A page that keeps its frames: calm the moment each return's step allows. */
const calmAtOnce = (onCalm: () => void, notBeforeS = 0) => {
	const t = setTimeout(onCalm, notBeforeS * 1000);
	return () => clearTimeout(t);
};

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

	it('rides the world until the rider picks Flat, and 3D brings it back', () => {
		const view = createWorldView();
		expect(view.on).toBe(true);
		view.flatten();
		expect(view.reason).toBe('chosen');
		expect(createWorldView().on).toBe(false);
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

	it('comes back by itself after a failure, later each time, a few times a ride (#4423)', () => {
		vi.useFakeTimers();
		try {
			setWorldMode('full');
			const view = createWorldView(calmAtOnce);
			for (const s of RETURN_S) {
				view.fail('frames');
				expect(view.on).toBe(false);
				vi.advanceTimersByTime(s * 1000 - 1);
				expect(view.on).toBe(false);
				vi.advanceTimersByTime(1);
				expect(view.on).toBe(true);
			}
			expect(cues.filter((c) => c === 'recover')).toHaveLength(RETURN_S.length);
			view.fail('context-lost');
			vi.advanceTimersByTime(3600_000);
			expect(view.reason).toBe('context-lost'); // past the last, only 3D
			expect(worldMode()).toBe('full');
		} finally {
			vi.useRealTimers();
		}
	});

	it('comes back within seconds of a stall, not a minute: the first step is short', () => {
		expect(RETURN_S[0]).toBeLessThanOrEqual(5);
		expect(RETURN_S[1]).toBeLessThan(60);
	});

	it('waits on the Skyline while the page still misses its frames', () => {
		vi.useFakeTimers();
		try {
			setWorldMode('full');
			let calm: (() => void) | null = null;
			const view = createWorldView((onCalm) => {
				calm = onCalm;
				return () => (calm = null);
			});
			view.fail('frames');
			vi.advanceTimersByTime(3600_000);
			expect(view.reason).toBe('frames'); // a page that never keeps up never gets it back
			calm!();
			expect(view.on).toBe(true);
			expect(cues).toEqual(['fault', 'recover']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('starts the short steps again once the world has held for a while', () => {
		vi.useFakeTimers();
		try {
			setWorldMode('full');
			const view = createWorldView(calmAtOnce);
			for (const s of RETURN_S.slice(0, 3)) {
				view.fail('frames');
				vi.advanceTimersByTime(s * 1000);
				expect(view.on).toBe(true);
			}
			vi.advanceTimersByTime(HELD_S * 1000);
			view.fail('frames');
			vi.advanceTimersByTime(RETURN_S[0] * 1000);
			expect(view.on).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('never brings the world back over the rider’s Flat, or after the ride', () => {
		vi.useFakeTimers();
		try {
			setWorldMode('full');
			const flat = createWorldView(calmAtOnce);
			flat.fail('frames');
			flat.flatten();
			vi.advanceTimersByTime(RETURN_S[0] * 1000);
			expect(flat.reason).toBe('chosen');
			setWorldMode('full');
			const over = createWorldView(calmAtOnce);
			over.fail('frames');
			over.dispose();
			vi.advanceTimersByTime(RETURN_S[0] * 1000);
			expect(over.reason).toBe('frames');
			expect(cues).not.toContain('recover');
		} finally {
			vi.useRealTimers();
		}
	});

	it('falls back, and 3D brings the world back at once', () => {
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
			at(560);
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
		const { prefersReducedMotion } = await import('#lib/motion/index.ts');
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
