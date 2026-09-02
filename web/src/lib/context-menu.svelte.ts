/**
 * Right-click menus (#465): every object with more than one action gets one —
 * primary action on click, everything else one right-click (or long-press)
 * away, never the only way. One menu is open at a time; `ContextMenuHost`
 * in the root layout draws it, `contextMenu(items)` attaches it to a node.
 */
import type { Component } from 'svelte';

export interface MenuItem {
	label: string;
	icon?: Component<{ size?: number | string; class?: string }>;
	onSelect: () => void;
	/** Destructive — takes the danger token. */
	danger?: boolean;
	disabled?: boolean;
	/** A trailing hint: a shortcut, a state ("on"), a count. */
	hint?: string;
}
export type MenuEntry = MenuItem | 'separator';

/**
 * What a menu-bearing object says on hover. The feature gets no icon and no
 * chevron — noise on a bike — so this one tooltip is its whole advertisement
 * (#486). One string, so every object words it the same.
 */
export const MENU_HINT = 'right-click for more';

export const menu = $state<{
	items: MenuEntry[];
	x: number;
	y: number;
	/** What was right-clicked — focus goes back to it on close. */
	anchor: HTMLElement | null;
}>({ items: [], x: 0, y: 0, anchor: null });

export function openMenu(
	items: MenuEntry[],
	x: number,
	y: number,
	anchor: HTMLElement | null,
): void {
	menu.items = items;
	menu.x = x;
	menu.y = y;
	menu.anchor = anchor;
}

export function closeMenu(): void {
	const back = menu.anchor;
	menu.items = [];
	menu.anchor = null;
	back?.focus?.({ preventScroll: true });
}

/**
 * Does this scroll invalidate the menu? Only one that moves the thing you
 * right-clicked. The room scrolls its own panes constantly — the chat sticks
 * to its newest line on every tick — and closing on ANY scroll shut the menu
 * about a second after it opened, wherever you had opened it (#500).
 */
export function scrollClosesMenu(
	target: EventTarget | null,
	anchor: HTMLElement | null,
): boolean {
	if (!anchor) return true;
	const scroller =
		target instanceof Element ? target : document.documentElement;
	return scroller.contains(anchor);
}

/** Keep the menu on screen: flip left of the pointer and above it when it would overflow. */
export function placeMenu(
	x: number,
	y: number,
	w: number,
	h: number,
	vw: number,
	vh: number,
): { left: number; top: number } {
	const margin = 8;
	let left = x;
	let top = y;
	if (left + w + margin > vw) left = Math.max(margin, x - w);
	if (top + h + margin > vh) top = Math.max(margin, y - h);
	return { left, top };
}

/** Long-press on touch opens the same menu — right-click has no finger. */
const LONG_PRESS_MS = 500;

/**
 * Attachment: `{@attach contextMenu(() => items)}`. The items are asked for
 * at open time, so a row can offer what is true right now.
 */
export function contextMenu(
	items: () => MenuEntry[],
): (node: HTMLElement) => () => void {
	return (node) => {
		let press: ReturnType<typeof setTimeout> | undefined;
		const open = (x: number, y: number) => {
			const list = items();
			if (list.length === 0) return;
			openMenu(list, x, y, node);
		};
		const onContext = (event: MouseEvent) => {
			// Nothing to offer (your own row, a ride the server never saw): leave
			// the browser's own menu alone rather than swallowing the click into
			// nothing, which is precisely what "it doesn't work" looks like.
			if (items().length === 0) return;
			event.preventDefault();
			event.stopPropagation();
			open(event.clientX, event.clientY);
		};
		const onDown = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') return;
			press = setTimeout(
				() => open(event.clientX, event.clientY),
				LONG_PRESS_MS,
			);
		};
		const cancel = () => clearTimeout(press);
		node.addEventListener('contextmenu', onContext);
		node.addEventListener('pointerdown', onDown);
		node.addEventListener('pointerup', cancel);
		node.addEventListener('pointermove', cancel);
		node.addEventListener('pointercancel', cancel);
		return () => {
			cancel();
			node.removeEventListener('contextmenu', onContext);
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointermove', cancel);
			node.removeEventListener('pointercancel', cancel);
			// Only a row that actually WENT AWAY takes its menu with it. A live
			// row re-renders under an open menu constantly — the roster is
			// rebuilt from every server tick, so `{@attach tileMenu(rider)}`
			// re-runs about once a second — and that teardown is the same node
			// coming straight back, not the rider leaving (#529).
			if (menu.anchor === node && !node.isConnected) closeMenu();
		};
	};
}
