// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keepSize } from '$lib/pane';

// happy-dom gives us elements, not storage.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
});

/** Stand-in for the browser's observer, so the callback can be driven. */
let fire: () => void = () => {};
class FakeResizeObserver {
	constructor(private cb: () => void) {
		fire = () => this.cb();
	}
	observe() {}
	disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

/** offsetWidth follows the inline width, the way a laid-out pane would. */
function pane(defaultWidth = 320) {
	const node = document.createElement('div');
	Object.defineProperty(node, 'offsetWidth', {
		get: () => parseInt(node.style.width, 10) || defaultWidth,
	});
	return node;
}

const widthVar = (key: string) =>
	document.documentElement.style.getPropertyValue(`--pane-${key}-w`);

describe('keepSize', () => {
	beforeEach(() => {
		store.clear();
		document.documentElement.removeAttribute('style');
	});

	it('restores the size the pane was left at', () => {
		store.set('wattroom.pane.side', JSON.stringify({ w: 440, h: 300 }));
		const node = pane();
		keepSize(node, 'side');
		expect(node.style.width).toBe('440px');
		expect(node.style.height).toBe('300px');
	});

	it('publishes the width on attach, not only from the observer', () => {
		// A fixed-position neighbour laid out in the same frame must not fall
		// back to the default width for a tick.
		store.set('wattroom.pane.side', JSON.stringify({ w: 440 }));
		keepSize(pane(), 'side');
		expect(widthVar('side')).toBe('440px');
	});

	it('stores nothing until the size differs from what was authored', () => {
		// Otherwise today's default freezes into storage and tomorrow's never
		// reaches anyone who has opened a room once.
		const node = pane();
		keepSize(node, 'side');
		fire();
		expect(store.get('wattroom.pane.side')).toBeUndefined();

		node.style.width = '500px';
		fire();
		expect(JSON.parse(store.get('wattroom.pane.side')!)).toMatchObject({
			w: 500,
		});
	});

	it('keeps a dragged position when the size changes', () => {
		// save() merges; a resize that dropped x/y would send a floating pane
		// back to its corner the next time it was opened.
		store.set('wattroom.pane.dock', JSON.stringify({ x: 120, y: 64 }));
		const node = pane();
		keepSize(node, 'dock');
		node.style.width = '500px';
		fire();
		expect(JSON.parse(store.get('wattroom.pane.dock')!)).toEqual({
			x: 120,
			y: 64,
			w: 500,
			h: 0,
		});
	});

	it('stops observing and drops the custom property on cleanup', () => {
		store.set('wattroom.pane.side', JSON.stringify({ w: 440 }));
		const stop = keepSize(pane(), 'side');
		expect(widthVar('side')).toBe('440px');
		stop();
		expect(widthVar('side')).toBe('');
	});

	it('opens at the authored size when storage is junk', () => {
		store.set('wattroom.pane.side', '{not json');
		const node = pane();
		expect(() => keepSize(node, 'side')).not.toThrow();
		expect(node.style.width).toBe('');
	});
});
