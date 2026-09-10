// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
	closeMenu,
	contextMenu,
	menu,
	placeMenu,
	scrollClosesMenu,
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

	// Escape used to drop a keyboard rider on the body (#1960): most anchors
	// are a plain <div> or <li>, on which focus() is a silent no-op.
	it('gives focus back to where it came from, or to the object itself', () => {
		const button = document.createElement('button');
		const node = document.createElement('div');
		document.body.append(button, node);
		const detach = contextMenu(() => [
			{ label: 'Message', onSelect: () => {} },
		])(node);
		button.focus();
		rightClick(node);
		closeMenu();
		expect(document.activeElement).toBe(button);

		// Nothing had focus: the object is made focusable and takes it.
		(document.activeElement as HTMLElement).blur();
		rightClick(node);
		closeMenu();
		expect(document.activeElement).toBe(node);
		detach();
		button.remove();
		node.remove();
	});

	// The roster is rebuilt from every server tick, so the attachment on a
	// rider's row is torn down and re-created about once a second. That is the
	// row re-rendering, not the rider leaving — and it was shutting the menu a
	// second after it opened (#529).
	it('survives the row re-rendering under it', () => {
		const node = document.createElement('div');
		document.body.append(node);
		const items = [{ label: 'Message', onSelect: () => {} }];
		let detach = contextMenu(() => items)(node);
		rightClick(node);
		expect(menu.items).toHaveLength(1);

		detach(); // a tick: same row, new rider object
		detach = contextMenu(() => items)(node);
		expect(menu.items).toHaveLength(1);

		// The rider actually leaving does take the menu with it.
		node.remove();
		detach();
		expect(menu.items).toHaveLength(0);
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

describe('long-press', () => {
	function touch(node: HTMLElement, type: string, x: number, y: number) {
		const event = new MouseEvent(type, {
			bubbles: true,
			clientX: x,
			clientY: y,
		});
		Object.defineProperty(event, 'pointerType', { value: 'touch' });
		node.dispatchEvent(event);
	}

	it('survives a thumb that drifts a few pixels, and yields to a scroll (#1628)', () => {
		vi.useFakeTimers();
		const node = document.createElement('div');
		const detach = contextMenu(() => [
			{ label: 'Message', onSelect: () => {} },
		])(node);
		touch(node, 'pointerdown', 30, 40);
		touch(node, 'pointermove', 33, 42);
		vi.advanceTimersByTime(600);
		expect(menu.items).toHaveLength(1);
		closeMenu();

		touch(node, 'pointerdown', 30, 40);
		touch(node, 'pointermove', 30, 70);
		vi.advanceTimersByTime(600);
		expect(menu.items).toHaveLength(0);
		detach();
		vi.useRealTimers();
	});
});

describe('scrollClosesMenu', () => {
	it('closes for a scroll that moves the anchor, ignores every other pane (#500)', () => {
		const page = document.createElement('div');
		const chat = document.createElement('div');
		const row = document.createElement('button');
		page.append(row);
		document.body.append(page, chat);

		// The chat sticking to its newest line must not shut a menu opened on
		// a sidebar row — that is the once-a-second close riders saw.
		expect(scrollClosesMenu(chat, row)).toBe(false);
		// Its own scroller, and the page itself, do move it.
		expect(scrollClosesMenu(page, row)).toBe(true);
		expect(scrollClosesMenu(document, row)).toBe(true);
		expect(scrollClosesMenu(chat, null)).toBe(true);

		page.remove();
		chat.remove();
	});
});
