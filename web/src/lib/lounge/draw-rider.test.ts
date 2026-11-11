import { describe, expect, it } from 'vitest';
import {
	CELL_W,
	GROUND,
	PEDAL_FRAMES,
	VIEWS,
	YAW,
	crankAngle,
	riderHead,
	type View,
} from '$lib/lounge/draw-rider';
import { dress } from '$lib/lounge/figures';
import { HAIR_NAMES, encodeLook, seededLook } from '$lib/lounge/look';

describe('the crank', () => {
	it('pedals forward: the front foot goes down as the stroke runs on', () => {
		// At stroke 0 the right foot is at the front (+x). A frame later it is lower.
		expect(Math.cos(crankAngle(0))).toBeCloseTo(1);
		expect(Math.sin(crankAngle(1))).toBeLessThan(0);
		// And the top of the stroke comes after the back, never before it.
		expect(Math.sin(crankAngle(PEDAL_FRAMES * 0.75))).toBeCloseTo(1);
	});
});

/** The road's nine turns from behind round to the front (rider-sprite.ts's TURNS). */
const TURNS = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180];
const nearest = (deg: number): View =>
	VIEWS.reduce((b, v) =>
		Math.abs(YAW[v] - deg) < Math.abs(YAW[b] - deg) ? v : b,
	);

/** Everyone with a pet, in every hair, with a cap and without. */
function riders(pet: number) {
	const out = [];
	for (let hair = 0; hair < HAIR_NAMES.length; hair++)
		for (const cap of [0, 5]) {
			const look = { ...seededLook('r'), hair, cap, pet };
			out.push(dress({ id: 'r', name: 'R', loungeLook: encodeLook(look) }));
		}
	return out;
}

/** Every cell a rider's sheet draws: each turn and pedal frame, seated and standing. */
function* cells(pet: number) {
	for (const f of riders(pet))
		for (const yaw of TURNS)
			for (const standing of [false, true])
				for (let stroke = 0; stroke < PEDAL_FRAMES; stroke++)
					yield {
						yaw,
						standing,
						at: riderHead(f, nearest(yaw), stroke, CELL_W / 2, GROUND, {
							yaw,
							standing,
						}),
					};
}

describe('a parrot on a bike', () => {
	it('perches beside the head, never on it, at every turn, stance and hair', () => {
		for (const { at } of cells(2)) {
			const p = at.pet!;
			const head = at.box;
			// Clear of the head and its hair: at most their ink lines touch.
			expect(p.x).toBeGreaterThanOrEqual(head.x + head.w);
			// On the shoulder, not off in the air: close beside the head, its
			// feet in the lower half of the head, where the shoulders are.
			expect(p.x - (head.x + head.w)).toBeLessThanOrEqual(4);
			const feet = p.y + p.h - 1;
			expect(feet).toBeGreaterThan(at.cy - 1);
			expect(feet).toBeLessThanOrEqual(at.cy + 8);
		}
	});

	it('sits on the side the face turns from, and looks the way the bike goes', () => {
		for (const { yaw, at } of cells(2)) {
			// As drawn the rider rides to the left: the face is the head's left.
			expect(at.pet!.x).toBeGreaterThan(at.cx);
			expect(at.pet!.mirror).toBe(yaw > 15 && yaw < 165);
		}
	});

	it('is drawn behind the rider only on the far shoulder', () => {
		for (const { yaw, at } of cells(2))
			// Up to side-on the right shoulder is the far one; past it the left is the near one.
			expect(at.pet!.behind).toBe(yaw > 0 && yaw <= 90);
	});
});

describe('a hamster on a bike', () => {
	it('sits on top of the head, centred, whatever the hair or cap', () => {
		for (const { at } of cells(3)) {
			const p = at.pet!;
			// Its bottom row stands over the head's top line of skin or cap.
			expect(p.y + p.h - 1).toBeLessThan(Math.round(at.cy - 4.5));
			expect(Math.abs(p.x + p.w / 2 - at.cx)).toBeLessThanOrEqual(1);
		}
	});
});

describe('no pet', () => {
	it('puts nothing on the bike, and a dog stays home', () => {
		for (const pet of [0, 1])
			for (const { at } of cells(pet)) expect(at.pet).toBeNull();
	});
});
