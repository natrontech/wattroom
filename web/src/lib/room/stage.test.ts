import { describe, expect, it } from 'vitest';
import { FIT, panBy, pickStage, zoomAbout } from './stage';

const screens = [
	{ key: 'screen:a', kind: 'screen' as const },
	{ key: 'screen:b', kind: 'screen' as const },
];
const cam = { key: 'cam:c', kind: 'cam' as const };
const jukebox = { key: 'jukebox', kind: 'jukebox' as const };

describe('pickStage (#280)', () => {
	it('honours your pick over the newest share', () => {
		expect(pickStage([...screens, cam], 'screen:a')?.key).toBe('screen:a');
		expect(pickStage([...screens, cam], 'cam:c')?.key).toBe('cam:c');
	});

	it('falls back to the newest share, never to a camera', () => {
		expect(pickStage([...screens, cam], null)?.key).toBe('screen:b');
		// The picked share ended: the other one takes over, not the webcam.
		expect(pickStage([screens[0], cam], 'screen:b')?.key).toBe('screen:a');
		expect(pickStage([cam], null)).toBe(null);
	});

	// #316: the room's video seats on the stage, but behind a share — someone
	// sharing a chart is saying "look at this", the music video is not.
	it('gives the jukebox the stage below a share, above a camera', () => {
		expect(pickStage([cam, jukebox], null)?.key).toBe('jukebox');
		expect(pickStage([...screens, cam, jukebox], null)?.key).toBe('screen:b');
		expect(pickStage([...screens, jukebox], 'jukebox')?.key).toBe('jukebox');
		// The track ended mid-pick: the stage falls back rather than blanking.
		expect(pickStage([...screens], 'jukebox')?.key).toBe('screen:b');
	});
});

describe('stage view (#280)', () => {
	it('keeps the cursor point still while zooming', () => {
		// 400×200 frame, cursor 100px right of centre, zoom to 2×: the pixel
		// under the cursor must not move.
		const zoomed = zoomAbout(FIT, 2, 100, 0, 400, 200);
		expect(zoomed.zoom).toBe(2);
		expect(zoomed.x).toBe(-100);
		// picture coordinate under the cursor, before and after
		expect((100 - zoomed.x) / zoomed.zoom).toBeCloseTo(100 - FIT.x);
	});

	it('clamps pan to the overflow and refuses to zoom out past fit', () => {
		const zoomed = zoomAbout(FIT, 2, 0, 0, 400, 200);
		expect(panBy(zoomed, 9999, 9999, 400, 200)).toEqual({
			zoom: 2,
			x: 200,
			y: 100,
		});
		// Below 1× there is nothing to see; the clamp also re-centres.
		expect(zoomAbout(zoomed, 0.1, 0, 0, 400, 200)).toEqual(FIT);
	});
});
