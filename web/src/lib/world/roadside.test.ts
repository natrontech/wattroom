import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { wavesInSight } from './roadside';

/** A camera at the origin looking down -z, as the world's at 1280 × 720. */
function eye() {
	const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
	camera.position.set(0, 1.5, 0);
	camera.lookAt(0, 1.5, -1);
	camera.updateMatrixWorld();
	return camera;
}
const at = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const HALF_H = 360;

// What keeps a standing world at 15 fps rather than a frame a second (#4533).
describe('someone waving in sight', () => {
	it('is someone near and in front of the camera', () => {
		expect(wavesInSight([at(2, -20)], eye(), HALF_H)).toBe(true);
	});

	it('is nobody behind the camera or off to the side', () => {
		expect(wavesInSight([at(0, 20), at(60, -10)], eye(), HALF_H)).toBe(false);
	});

	it('is nobody so far that the arm is under half a screen pixel', () => {
		// 0.05 m an art pixel, 2.14 the projection's focal factor at 50°: about 86 m at 360.
		expect(wavesInSight([at(0, -80)], eye(), HALF_H)).toBe(true);
		expect(wavesInSight([at(0, -95)], eye(), HALF_H)).toBe(false);
		// Twice the drawing buffer sees an arm twice as far.
		expect(wavesInSight([at(0, -170)], eye(), 2 * HALF_H)).toBe(true);
	});

	it('is nobody when nobody waves', () => {
		expect(wavesInSight([], eye(), HALF_H)).toBe(false);
	});
});
