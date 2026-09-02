// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
	closeMenu,
	contextMenu,
	menu,
	placeMenu,
} from '$lib/context-menu.svelte';

describe('placeMenu', () => {
	it('opens at the pointer when there is room', () => {
		expect(placeMenu(100, 100, 200, 150, 1440, 900)).toEqual({
			left: 100,
			top: 100,
		});
	});
	it('flips left and up at the edges, never off screen', () => {
		expect(placeMenu(1400, 880, 200, 150, 1440, 900)).toEqual({
			left: 1200,
			top: 730,
		});
		expect(placeMenu(50, 890, 200, 950, 1440, 900).top).toBe(8);
	});
});

describe('contextMenu', () => {
	function rightClick(node: HTMLElement) {
		const event = new MouseEvent('contextmenu', {
			cancelable: true,
			bubbles: true,
			clientX: 30,
			clientY: 40,
		});
		node.dispatchEvent(event);
		return event;
	}

	it('opens at the pointer for an object with actions', () => {
		const node = document.createElement('div');
		const detach = contextMenu(() => [
			{ label: 'Message', onSelect: () => {} },
		])(node);
		const event = rightClick(node);
		expect(event.defaultPrevented).toBe(true);
		expect(menu.items).toHaveLength(1);
		expect([menu.x, menu.y]).toEqual([30, 40]);
		closeMenu();
		detach();
	});

	// An object with nothing to offer used to swallow the right-click and draw
	// nothing, which is exactly what "the menu doesn't work" looks like (#486).
	it('leaves the browser its own menu when there is nothing to offer', () => {
		const node = document.createElement('div');
		const detach = contextMenu(() => [])(node);
		const event = rightClick(node);
		expect(event.defaultPrevented).toBe(false);
		expect(menu.items).toHaveLength(0);
		detach();
	});
});
