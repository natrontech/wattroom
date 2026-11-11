// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '#lib/road/route.ts';
import { RIDE } from './look.test-helper';
import { compose, type Composed } from './compose';
import { CAMERA_PRESETS } from './cameras';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A camera change is a cut, drawn at once (docs/spec/motion.md). A rider
 * standing at a voice channel's free ride before pedalling has a world that
 * draws a frame a second, each moving it on a tenth of a second (scene.ts's
 * MAX_DT): the switch used to ease over the follow's half-life at that rate,
 * and crawled for 11 s.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
}, BUILD_MS);

/** A rider standing on the road, as before the first pedal stroke. */
const standing = () =>
	compose(
		{
			route,
			world,
			style: RIDE,
			ftp: 250,
			watts: 0,
			metre: () => ({ m: 300, mps: 0 }),
		},
		null,
	);

const eye = (w: Composed) => {
	w.camera.updateMatrixWorld();
	return [...w.camera.matrixWorld.elements, w.camera.fov];
};

/** An idle frame as the loop draws it: a tenth of a second of the ride. */
const IDLE_FRAME = 0.1;

describe('a camera change while the rider stands', () => {
	it.each(CAMERA_PRESETS.filter((c) => c !== 'chase'))(
		'draws the %s shot on the next frame, and stands still after',
		(preset) => {
			const w = standing();
			for (let k = 0; k < 40; k++) w.advanceBy(IDLE_FRAME);
			expect(w.idle()).toBe(true);

			w.setCamera(preset);
			// Owed a frame now, not at the next idle second.
			expect(w.idle()).toBe(false);
			w.advanceBy(IDLE_FRAME);
			const cut = eye(w);
			// Drawn on while the ground round the new eye comes in, at most 2 s,
			// then still again; the shot never moves meanwhile.
			let drawn = 0;
			while (!w.idle() && drawn < 90) {
				w.advanceBy(1 / 30);
				drawn++;
			}
			expect(drawn).toBeLessThanOrEqual(61);
			expect(w.idle()).toBe(true);
			for (let k = 0; k < 30; k++) w.advanceBy(IDLE_FRAME);
			const later = eye(w);
			cut.forEach((v, i) => expect(later[i]).toBeCloseTo(v, 2));
			w.dispose();
		},
	);

	it('asks for no frame when the shot is the one shown', () => {
		const w = standing();
		for (let k = 0; k < 40; k++) w.advanceBy(IDLE_FRAME);
		w.setCamera('chase');
		expect(w.idle()).toBe(true);
		w.dispose();
	});
});
