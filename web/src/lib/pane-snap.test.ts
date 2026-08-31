import { describe, expect, it } from 'vitest';
import { resizeRect, SNAP, snapSpan } from '$lib/pane-snap';

// A 1000×800 viewport with a 320px side panel, as the room lays it out.
const guides = { x: [0, 500, 680, 1000], y: [0, 400, 800] };
const limits = { minW: 260, minH: 256, maxW: 960, maxH: 720 };
const start = { left: 400, top: 300, width: 380, height: 308 };

describe('soft guides (#316)', () => {
	it('clicks a pane to the gutter it is nearly touching', () => {
		// Right edge at 680 - 4: within reach of the side panel's gutter.
		expect(snapSpan(296, 380, guides.x)).toBe(300);
	});

	it('makes centred a place you can drop something', () => {
		// Middle at 500 - 3, so the pane lands centred on the viewport.
		expect(snapSpan(307, 380, guides.x)).toBe(310);
	});

	it('lets go the moment you keep pulling', () => {
		const past = 300 - SNAP - 1;
		expect(snapSpan(past, 380, guides.x)).toBe(past);
	});
});

describe('resizeRect (#316)', () => {
	it('moves only the edge you grabbed', () => {
		expect(resizeRect(start, 'e', 100, 60, limits, { x: [], y: [] })).toEqual({
			left: 400,
			top: 300,
			width: 480,
			height: 308,
		});
		expect(resizeRect(start, 'n', 100, -60, limits, { x: [], y: [] })).toEqual({
			left: 400,
			top: 240,
			width: 380,
			height: 368,
		});
	});

	it('grows up and left from a north-west corner', () => {
		const r = resizeRect(start, 'nw', -100, -100, limits, { x: [], y: [] });
		expect(r).toEqual({ left: 300, top: 200, width: 480, height: 408 });
	});

	it('pins the opposite edge at the minimum instead of walking the pane', () => {
		// Dragged west edge far past the floor: the east edge must not move.
		const r = resizeRect(start, 'w', 900, 0, limits, { x: [], y: [] });
		expect(r.width).toBe(limits.minW);
		expect(r.left + r.width).toBe(start.left + start.width);
	});

	it('stops at the ceiling as well', () => {
		const r = resizeRect(start, 'e', 5000, 0, limits, { x: [], y: [] });
		expect(r.width).toBe(limits.maxW);
		expect(r.left).toBe(start.left);
	});

	it('snaps a dragged edge to a guide', () => {
		// East edge lands on 676 — the gutter at 680 takes it.
		const r = resizeRect(start, 'e', -104, 0, limits, guides);
		expect(r.left + r.width).toBe(680);
	});
});
