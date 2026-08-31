// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keepSize } from '$lib/room/keep-size';

// happy-dom gives us elements, not storage.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	clear: () => store.clear(),
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

function pane(width: number, height: number) {
	const node = document.createElement('div');
	Object.defineProperty(node, 'offsetWidth', { get: () => width });
	Object.defineProperty(node, 'offsetHeight', { get: () => height });
	return node;
}

describe('keepSize', () => {
	beforeEach(() => localStorage.clear());

	it('restores the size it was left at', () => {
		localStorage.setItem('pane', JSON.stringify({ w: 640, h: 300 }));
		const node = pane(640, 300);
		keepSize('pane')(node);
		expect(node.style.width).toBe('640px');
		expect(node.style.height).toBe('300px');
	});

	it('restores only the width on a horizontal pane', () => {
		// The side panel is full height by layout; a stored height would fight it.
		localStorage.setItem('pane', JSON.stringify({ w: 420, h: 300 }));
		const node = pane(420, 900);
		keepSize('pane', 'horizontal')(node);
		expect(node.style.width).toBe('420px');
		expect(node.style.height).toBe('');
	});

	it('records a resize', () => {
		keepSize('pane')(pane(700, 320));
		fire();
		expect(JSON.parse(localStorage.getItem('pane')!)).toEqual({
			w: 700,
			h: 320,
		});
	});

	it('ignores a hidden pane, which measures zero', () => {
		localStorage.setItem('pane', JSON.stringify({ w: 700, h: 320 }));
		keepSize('pane')(pane(0, 0));
		fire();
		expect(JSON.parse(localStorage.getItem('pane')!)).toEqual({
			w: 700,
			h: 320,
		});
	});

	it('opens at the default size when storage is junk', () => {
		localStorage.setItem('pane', '{not json');
		const node = pane(976, 420);
		expect(() => keepSize('pane')(node)).not.toThrow();
		expect(node.style.width).toBe('');
	});
});
