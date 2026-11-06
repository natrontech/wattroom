import { describe, expect, it } from 'vitest';
import { SCENE_H, hasFront, middleOf, wallScreen } from './scene';

describe('a picture on the wall', () => {
	const rooms = [
		[400, 258],
		[720, 333],
		[540, 328],
		[430, 245],
		[320, 190],
	] as const;

	it.each(rooms)('hangs 16:9 inside a %i × %i room', (w, h) => {
		const s = wallScreen(w, h);
		expect(Math.abs(s.w / s.h - 16 / 9)).toBeLessThan(0.02);
		expect(s.x).toBeGreaterThanOrEqual(0);
		expect(s.x + s.w).toBeLessThanOrEqual(w);
		expect(s.y).toBeGreaterThanOrEqual(0);
		expect(s.y + s.h).toBeLessThanOrEqual(h);
	});

	it('gives the wall every row the stage does not need', () => {
		expect(middleOf(400, 258, true).oy).toBe(258 - SCENE_H);
	});

	it('stops above the sofa, however tall the wall', () => {
		const { oy } = middleOf(400, 258, true);
		const s = wallScreen(400, 258);
		expect(s.y + s.h).toBeLessThanOrEqual(oy + 52);
	});

	it('has no front row: the floor is the stage alone', () => {
		expect(hasFront(400, 500)).toBe(true);
		expect(hasFront(400, 500, true)).toBe(false);
	});

	it('leaves a room with nothing on the wall as it was', () => {
		expect(middleOf(400, 258)).toEqual(middleOf(400, 258, false));
	});
});
