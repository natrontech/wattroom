// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
	offerSeat,
	sameSeat,
	seatOf,
	stageSlot,
} from '$lib/room/stage-slot.svelte';

// happy-dom lays nothing out: the hole's rect is scripted, and animation
// frames are stepped by hand — `tick()` runs whatever a frame would.
let frames: FrameRequestCallback[] = [];
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
	frames.push(cb);
	return frames.length;
});
vi.stubGlobal('cancelAnimationFrame', () => {
	frames = [];
});
let intersect: (ratio: number) => void = () => {};
class FakeIntersectionObserver {
	constructor(private cb: (entries: { intersectionRatio: number }[]) => void) {
		intersect = (ratio) => this.cb([{ intersectionRatio: ratio }]);
	}
	observe() {}
	disconnect = vi.fn();
}
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

function tick() {
	const due = frames;
	frames = [];
	for (const cb of due) cb(0);
}

function rect(box: {
	left: number;
	top: number;
	width: number;
	height: number;
}) {
	return {
		...box,
		x: box.left,
		y: box.top,
		right: box.left + box.width,
		bottom: box.top + box.height,
		toJSON: () => box,
	} as DOMRect;
}

function hole(box: {
	left: number;
	top: number;
	width: number;
	height: number;
}) {
	const node = document.createElement('div');
	const live = { ...box };
	node.getBoundingClientRect = () => rect(live);
	return { node, box: live };
}

describe('seatOf', () => {
	it('is the rect while visible, and nothing while hidden or unlaid-out', () => {
		const r = rect({ left: 10, top: 20, width: 300, height: 200 });
		expect(seatOf(r, true)).toEqual({ x: 10, y: 20, w: 300, h: 200 });
		expect(seatOf(r, false)).toBeNull();
		expect(
			seatOf(rect({ left: 0, top: 0, width: 0, height: 0 }), true),
		).toBeNull();
	});
});

describe('sameSeat', () => {
	it('compares the four numbers, and null only with null', () => {
		const a = { x: 1, y: 2, w: 3, h: 4 };
		expect(sameSeat(a, { ...a })).toBe(true);
		expect(sameSeat(a, { ...a, y: 9 })).toBe(false);
		expect(sameSeat(null, null)).toBe(true);
		expect(sameSeat(a, null)).toBe(false);
	});
});

describe('offerSeat', () => {
	it('publishes at once and follows a move that resized nothing', () => {
		const { node, box } = hole({ left: 10, top: 20, width: 300, height: 200 });
		const stop = offerSeat(node);
		expect({ ...stageSlot.seat }).toEqual({ x: 10, y: 20, w: 300, h: 200 });
		// A banner appeared above the stage: same size, new place — the case
		// no observer fires for (#395).
		box.top = 80;
		tick();
		expect(stageSlot.seat?.y).toBe(80);
		stop();
		expect(stageSlot.seat).toBeNull();
	});

	it('withdraws the seat while the stage is mostly off screen', () => {
		const { node } = hole({ left: 0, top: 0, width: 300, height: 200 });
		const stop = offerSeat(node);
		intersect(0.2);
		expect(stageSlot.seat).toBeNull();
		intersect(1);
		expect(stageSlot.seat).not.toBeNull();
		stop();
	});
});
