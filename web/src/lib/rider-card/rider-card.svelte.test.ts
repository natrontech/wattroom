// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CARD_W,
	CLOSE_MS,
	OPEN_MS,
	hoverCard,
	placeCard,
	riderCard,
} from './rider-card.svelte';

const pointer = (type: string, pointerType = 'mouse') =>
	Object.assign(new Event(type), { pointerType });

describe('hoverCard', () => {
	let desk = true;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('matchMedia', () => ({ matches: desk }));
	});
	afterEach(() => {
		riderCard.close();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		desk = true;
	});

	const face = (id: string) => {
		const node = document.createElement('span');
		const off = hoverCard(() => id)(node);
		return { node, off };
	};

	it('opens after the pointer rests, not on the way past', () => {
		const { node } = face('ann');
		node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS - 50);
		node.dispatchEvent(pointer('pointerleave'));
		vi.advanceTimersByTime(OPEN_MS);
		expect(riderCard.current).toBeNull();

		node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS);
		expect(riderCard.current?.id).toBe('ann');
	});

	it('stays while the pointer crosses into the card, and closes when it leaves', () => {
		const { node } = face('ann');
		node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS);
		node.dispatchEvent(pointer('pointerleave'));
		riderCard.keep();
		vi.advanceTimersByTime(CLOSE_MS * 2);
		expect(riderCard.current?.id).toBe('ann');

		riderCard.leave();
		vi.advanceTimersByTime(CLOSE_MS);
		expect(riderCard.current).toBeNull();
	});

	it('swaps at once from one rider to the next', () => {
		const ann = face('ann');
		const ben = face('ben');
		ann.node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS);
		ann.node.dispatchEvent(pointer('pointerleave'));
		ben.node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(0);
		expect(riderCard.current?.id).toBe('ben');
	});

	it('never opens for touch, or on a screen without hover', () => {
		const { node } = face('ann');
		node.dispatchEvent(pointer('pointerenter', 'touch'));
		vi.advanceTimersByTime(OPEN_MS);
		expect(riderCard.current).toBeNull();

		desk = false;
		node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS);
		expect(riderCard.current).toBeNull();
	});

	it('closes on a click, which goes where the face goes', () => {
		const { node } = face('ann');
		node.dispatchEvent(pointer('pointerenter'));
		vi.advanceTimersByTime(OPEN_MS);
		node.dispatchEvent(pointer('pointerdown'));
		expect(riderCard.current).toBeNull();
	});
});

describe('placeCard', () => {
	const viewport = { width: 1280, height: 800 };

	it('sits to the right of the face, level with it', () => {
		expect(
			placeCard(
				{ left: 100, right: 130, top: 200, bottom: 230 },
				180,
				viewport,
			),
		).toEqual({ left: 138, top: 200 });
	});

	it('goes left when the right has no room', () => {
		const at = placeCard(
			{ left: 1100, right: 1130, top: 200, bottom: 230 },
			180,
			viewport,
		);
		expect(at.left).toBe(1100 - 8 - CARD_W);
	});

	it('stays on screen at the bottom edge', () => {
		expect(
			placeCard({ left: 100, right: 130, top: 780, bottom: 800 }, 180, viewport)
				.top,
		).toBe(800 - 180 - 8);
	});

	it('drops below the face when neither side has room', () => {
		expect(
			placeCard({ left: 40, right: 340, top: 100, bottom: 130 }, 180, {
				width: 375,
				height: 812,
			}),
		).toEqual({ left: 40, top: 138 });
	});
});
