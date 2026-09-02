// @vitest-environment happy-dom
// `tick` here steps the fake re-measure timer; Svelte's is the effect flush.
import { tick as flushEffects } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import {
	bestOffer,
	COLUMN_SEAT,
	offerSeat,
	outranksColumn,
	onSeat,
	RAIL_SEAT,
	sameSeat,
	seatOf,
	stageSlot,
	STAGE_SEAT,
	TV_SEAT,
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
		const stopColumn = offerSeat(column.node, COLUMN_SEAT);
		expect(seen?.w).toBe(248);
		const stopStage = offerSeat(stage.node, STAGE_SEAT);
		expect(seen?.w).toBe(900);
		stopStage();
		expect(seen?.w).toBe(248);
		stopColumn();
		expect(seen).toBeNull();
	});

	// #427: the rail is on every framed page and offers whenever a track is
	// playing, so it must lose to every surface that only exists when there is
	// somewhere better for the video to be.
	it('lets the people column take the player off the rail', () => {
		const rail = hole({ left: 0, top: 300, width: 216, height: 200 });
		const column = hole({ left: 1000, top: 0, width: 248, height: 200 });
		const stopRail = offerSeat(rail.node, RAIL_SEAT);
		expect(seen?.w).toBe(216);
		const stopColumn = offerSeat(column.node, COLUMN_SEAT);
		expect(seen?.w).toBe(248);
		stopColumn();
		expect(seen?.w).toBe(216);
		stopRail();
	});

	it('ranks rail below column below stage below TV', () => {
		expect(RAIL_SEAT).toBeLessThan(COLUMN_SEAT);
		expect(COLUMN_SEAT).toBeLessThan(STAGE_SEAT);
		expect(STAGE_SEAT).toBeLessThan(TV_SEAT);
	});

	it('bestOffer ignores withdrawn offers and prefers priority', () => {
		const a = { priority: 1, seat: { x: 0, y: 0, w: 1, h: 1 } };
		const b = { priority: 2, seat: null };
		expect(bestOffer([a, b])?.w).toBe(1);
		expect(bestOffer([])).toBeNull();
	});

	// The deck collapses its 200 px hole when the stage has the player (#504),
	// and this is the flag it reads. It must answer only about surfaces ABOVE
	// the column: the column hides its hole from the answer, so counting the
	// column's own offer would close a loop — hidden, withdrawn, shown again.
	it('says when a surface above the column is offering, ignoring the column', () => {
		const column = hole({ left: 0, top: 0, width: 248, height: 200 });
		const stage = hole({ left: 300, top: 50, width: 900, height: 500 });
		expect(stageSlot.outranked).toBe(false);
		const stopColumn = offerSeat(column.node, COLUMN_SEAT);
		expect(stageSlot.outranked).toBe(false);
		const stopStage = offerSeat(stage.node, STAGE_SEAT);
		expect(stageSlot.outranked).toBe(true);
		// The column withdrawing — which is what hiding the hole does — must
		// not change the answer, or the deck flaps.
		stopColumn();
		expect(stageSlot.outranked).toBe(true);
		stopStage();
		expect(stageSlot.outranked).toBe(false);
	});

	it('outranksColumn counts only live offers above the column', () => {
		const live = { priority: TV_SEAT, seat: { x: 0, y: 0, w: 1, h: 1 } };
		const withdrawn = { priority: STAGE_SEAT, seat: null };
		const mine = { priority: COLUMN_SEAT, seat: { x: 0, y: 0, w: 1, h: 1 } };
		expect(outranksColumn([mine])).toBe(false);
		expect(outranksColumn([mine, withdrawn])).toBe(false);
		expect(outranksColumn([mine, live])).toBe(true);
	});
});

describe('reactivity', () => {
	it('keeps the rect out of state and only flips a boolean (#494)', () => {
		const box = hole({ left: 0, top: 0, width: 300, height: 200 });
		expect(stageSlot.seated).toBe(false);
		const stop = offerSeat(box.node, COLUMN_SEAT);
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

	// The first publish runs inside a surface's `{@attach}` — an effect. An
	// effect that READS the state it writes is invalidated by its own write,
	// so the attachment tears down, re-attaches, publishes again, and Svelte
	// stops the whole tree with effect_update_depth_exceeded. That is why
	// `seated` and `outranked` are guarded by module variables and never by a
	// read of themselves; this pins it, because the shape has come back twice
	// (#494, then a Training place that wedged with a track playing on
	// 27a1a50, before #550's rail seat hid it).
	it('offers a seat from inside an effect without re-running it', async () => {
		const { node } = hole({ left: 0, top: 0, width: 300, height: 200 });
		let runs = 0;
		const dispose = $effect.root(() => {
			$effect(() => {
				runs++;
				return offerSeat(node, COLUMN_SEAT);
			});
		});
		await flushEffects();
		expect(runs).toBe(1);
		expect(stageSlot.seated).toBe(true);
		dispose();
		expect(stageSlot.seated).toBe(false);
	});
});
