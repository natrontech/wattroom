import { describe, expect, it } from 'vitest';
import { clampPan, MAX_ZOOM, stageOf, zoomAt } from '$lib/room/stage';

const frame = { width: 800, height: 450 };

describe('stageOf', () => {
	it('honours a live pick, screen or camera', () => {
		expect(stageOf({ kind: 'camera', id: 'jan' }, ['sven'], ['jan'])).toEqual({
			kind: 'camera',
			id: 'jan',
		});
	});

	it('falls back to the NEWEST share when the pick ends', () => {
		// A teammate stopping their share must not blank yours (#219).
		expect(
			stageOf({ kind: 'screen', id: 'gone' }, ['sven', 'jan'], []),
		).toEqual({ kind: 'screen', id: 'jan' });
	});

	it('is empty only when nobody is sharing', () => {
		expect(stageOf(null, [], ['jan'])).toBeNull();
		expect(stageOf({ kind: 'camera', id: 'off' }, [], [])).toBeNull();
	});
});

describe('zoomAt', () => {
	const flat = { zoom: 1, tx: 0, ty: 0 };

	it('holds the point under the cursor still', () => {
		const at = { x: 600, y: 300 };
		const next = zoomAt(flat, at.x, at.y, 2, frame);
		// Where that content point lands after the transform.
		const landedX = next.tx + ((at.x - flat.tx) / flat.zoom) * next.zoom;
		const landedY = next.ty + ((at.y - flat.ty) / flat.zoom) * next.zoom;
		expect(landedX).toBeCloseTo(at.x);
		expect(landedY).toBeCloseTo(at.y);
	});

	it('never zooms out past the frame, nor in past the ceiling', () => {
		expect(zoomAt(flat, 0, 0, 0.5, frame).zoom).toBe(1);
		expect(zoomAt({ zoom: MAX_ZOOM, tx: 0, ty: 0 }, 0, 0, 2, frame).zoom).toBe(
			MAX_ZOOM,
		);
	});

	it('leaves no gap at the edges when zooming at a corner', () => {
		const next = zoomAt(flat, frame.width, frame.height, 4, frame);
		expect(next.tx).toBeGreaterThanOrEqual(frame.width * (1 - next.zoom));
		expect(next.ty).toBeGreaterThanOrEqual(frame.height * (1 - next.zoom));
		expect(next.tx).toBeLessThanOrEqual(0);
	});
});

describe('clampPan', () => {
	it('pins a dragged picture to the frame on both axes', () => {
		expect(clampPan({ zoom: 2, tx: 500, ty: -9999 }, frame)).toEqual({
			zoom: 2,
			tx: 0,
			ty: -450,
		});
	});
});
