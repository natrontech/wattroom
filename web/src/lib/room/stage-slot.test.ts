// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
	bestOffer,
	offerSeat,
	onSeat,
	sameSeat,
	seatOf,
	setPopped,
	stageSlot,
} from '$lib/room/stage-slot.svelte';

// happy-dom lays nothing out: the hole's rect is scripted, and the
// re-measure timer is stepped by hand — `tick()` runs one of its rounds.
let timers: (() => void)[] = [];
vi.stubGlobal('setInterval', (cb: () => void) => {
	timers.push(cb);
	return timers.length;
});
vi.stubGlobal('clearInterval', (id: number) => {
	if (typeof id === 'number') timers = timers.filter((_, i) => i + 1 !== id);
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
// happy-dom exposes no storage here; the pop-out preference needs one.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => stored.get(k) ?? null,
	setItem: (k: string, v: string) => void stored.set(k, v),
	removeItem: (k: string) => void stored.delete(k),
});

let seen: { x: number; y: number; w: number; h: number } | null = null;
onSeat((s) => (seen = s));

function tick() {
	for (const cb of [...timers]) cb();
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
		expect(seen).toEqual({ x: 10, y: 20, w: 300, h: 200 });
		// A banner appeared above the stage: same size, new place — the case
		// no observer fires for (#395).
		box.top = 80;
		tick();
		expect(seen?.y).toBe(80);
		stop();
		expect(seen).toBeNull();
	});

	it('withdraws the seat while the stage is mostly off screen', () => {
		const { node } = hole({ left: 0, top: 0, width: 300, height: 200 });
		const stop = offerSeat(node);
		intersect(0.2);
		expect(seen).toBeNull();
		intersect(1);
		expect(seen).not.toBeNull();
		stop();
	});
});

describe('two surfaces offering', () => {
	it('seats the player in the higher-priority hole, and falls back when it goes', () => {
		const column = hole({ left: 0, top: 0, width: 248, height: 200 });
		const stage = hole({ left: 300, top: 50, width: 900, height: 500 });
		const stopColumn = offerSeat(column.node, 1);
		expect(seen?.w).toBe(248);
		const stopStage = offerSeat(stage.node, 2);
		expect(seen?.w).toBe(900);
		stopStage();
		expect(seen?.w).toBe(248);
		stopColumn();
		expect(seen).toBeNull();
	});

	it('bestOffer ignores withdrawn offers and prefers priority', () => {
		const a = { priority: 1, seat: { x: 0, y: 0, w: 1, h: 1 } };
		const b = { priority: 2, seat: null };
		expect(bestOffer([a, b])?.w).toBe(1);
		expect(bestOffer([])).toBeNull();
	});
});

describe('popping out', () => {
	it('is remembered per device and cleared on put-back', () => {
		setPopped(true);
		expect(stageSlot.popped).toBe(true);
		expect(localStorage.getItem('wattroom.jukebox.popout.v1')).toBe('1');
		setPopped(false);
		expect(stageSlot.popped).toBe(false);
		expect(localStorage.getItem('wattroom.jukebox.popout.v1')).toBeNull();
	});
});

describe('reactivity', () => {
	it('keeps the rect out of state and only flips a boolean (#494)', () => {
		const box = hole({ left: 0, top: 0, width: 300, height: 200 });
		expect(stageSlot.seated).toBe(false);
		const stop = offerSeat(box.node, 1);
		expect(stageSlot.seated).toBe(true);
		// The rect moving must not touch state — only the listener hears it.
		box.box.top = 400;
		tick();
		expect(seen?.y).toBe(400);
		expect(stageSlot.seated).toBe(true);
		expect('seat' in stageSlot).toBe(false);
		stop();
		expect(stageSlot.seated).toBe(false);
	});
});

describe('popping out', () => {
	it('takes the player off every surface, not just the column', () => {
		const stage = hole({ left: 0, top: 0, width: 900, height: 500 });
		const stop = offerSeat(stage.node, 2);
		expect(seen?.w).toBe(900);
		setPopped(true);
		expect(seen).toBeNull();
		expect(stageSlot.seated).toBe(false);
		setPopped(false);
		expect(seen?.w).toBe(900);
		stop();
	});
});
