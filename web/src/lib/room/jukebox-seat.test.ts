// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// happy-dom leaves localStorage to the test, the way $lib/pane's do.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
});

const {
	claims,
	claimSeat,
	fits,
	hydrateSeat,
	MIN_SEAT,
	seatNode,
	seating,
	setSeat,
} = await import('./jukebox-seat.svelte');

/** Seats are measured, never trusted — the tests measure with a lookup. */
function measurer(sizes: Map<HTMLElement, [number, number]>) {
	return (node: HTMLElement) => {
		const [width, height] = sizes.get(node) ?? [0, 0];
		return { width, height };
	};
}

function box(): HTMLElement {
	return document.createElement('div');
}

beforeEach(() => {
	localStorage.clear();
	seating.want = 'panel';
	seating.at = 'float';
	claims.panel.length = 0;
	claims.room.length = 0;
});

describe('fits', () => {
	it('holds the RMF floor in both dimensions', () => {
		expect(fits({ width: MIN_SEAT, height: MIN_SEAT })).toBe(true);
		expect(fits({ width: MIN_SEAT - 1, height: 400 })).toBe(false);
		expect(fits({ width: 400, height: MIN_SEAT - 1 })).toBe(false);
	});
});

describe('the remembered seat', () => {
	it("starts in the panel — the room's music surface", () => {
		hydrateSeat();
		expect(seating.want).toBe('panel');
	});

	it('survives a reload', () => {
		setSeat('room');
		seating.want = 'panel';
		hydrateSeat();
		expect(seating.want).toBe('room');
	});

	it('ignores a stored value that is not a seat', () => {
		localStorage.setItem('wattroom.jukebox.seat', 'wherever');
		hydrateSeat();
		expect(seating.want).toBe('panel');
	});
});

describe('seatNode', () => {
	it('floats when nothing has claimed the chosen seat', () => {
		expect(seatNode(measurer(new Map()))).toBeNull();
	});

	it('floats when the rider asked it to', () => {
		const node = box();
		claimSeat('panel', node);
		setSeat('float');
		expect(seatNode(measurer(new Map([[node, [400, 300]]])))).toBeNull();
	});

	it('takes the newest claim — the summoned sheet, not the hidden column', () => {
		const hidden = box();
		const sheet = box();
		claimSeat('panel', hidden);
		claimSeat('panel', sheet);
		const sizes = new Map<HTMLElement, [number, number]>([
			[hidden, [0, 0]],
			[sheet, [300, 220]],
		]);
		expect(seatNode(measurer(sizes))).toBe(sheet);
	});

	it('skips a claim too small for the player and floats rather than squeezing', () => {
		const cramped = box();
		claimSeat('panel', cramped);
		const sizes = new Map<HTMLElement, [number, number]>([
			[cramped, [180, 140]],
		]);
		expect(seatNode(measurer(sizes))).toBeNull();
	});

	it('releases a claim when the surface goes away', () => {
		const node = box();
		const release = claimSeat('panel', node);
		release();
		expect(seatNode(measurer(new Map([[node, [400, 300]]])))).toBeNull();
	});

	it('never answers with another seat than the one chosen', () => {
		const inRoom = box();
		claimSeat('room', inRoom);
		const sizes = new Map<HTMLElement, [number, number]>([
			[inRoom, [800, 400]],
		]);
		expect(seatNode(measurer(sizes))).toBeNull();
		setSeat('room');
		expect(seatNode(measurer(sizes))).toBe(inRoom);
	});
});
