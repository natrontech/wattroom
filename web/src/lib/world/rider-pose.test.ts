import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bikeParts } from './bike-geometry';
import { effortRpm } from './figure/cadence';
import { buildGeometry } from './rider-geometry';
import { makeRider } from './rider-model';
import { pose } from './rider-pose';
import { B, DETAIL, GEO } from './rider-rig';

// The crank arm drawn on one side: the crank bone's part whose centre sits
// off the axle, on that side of the frame.
function armCentre(side: 1 | -1): THREE.Vector3 {
	const arm = bikeParts(DETAIL).find((geo) => {
		if (geo.attributes.skinIndex.getX(0) !== B.crank) return false;
		geo.computeBoundingBox();
		const c = geo.boundingBox!.getCenter(new THREE.Vector3());
		return Math.hypot(c.x, c.y) > 0.05 && Math.sign(c.z) === side;
	});
	if (!arm) throw new Error(`no crank arm on side ${side}`);
	return arm.boundingBox!.getCenter(new THREE.Vector3());
}

describe('the rider on the bike', () => {
	const model = makeRider(buildGeometry(), new THREE.MeshBasicMaterial());
	const bb = new THREE.Vector2(GEO.bb[0], GEO.bb[1]);

	for (const [side, foot] of [
		[1, 'footR'],
		[-1, 'footL'],
	] as const) {
		it(`stands the ${foot === 'footR' ? 'right' : 'left'} foot on the end of its crank arm`, () => {
			const centre = armCentre(side);
			for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
				pose(model, { crank: a, wheel: 0 });
				const bone = model.bones.crank;
				bone.updateMatrix();
				const drawn = centre.clone().applyMatrix4(bone.matrix);
				const ankle = model.bones[foot].position;
				const pedal = new THREE.Vector2(
					ankle.x - GEO.ankleOff[0],
					ankle.y - GEO.ankleOff[1],
				);
				const toArm = new THREE.Vector2(drawn.x, drawn.y).sub(bb).normalize();
				const toPedal = pedal.sub(bb).normalize();
				expect(toArm.dot(toPedal), `crank at ${a.toFixed(2)} rad`).toBeCloseTo(
					1,
					5,
				);
			}
		});
	}
});

describe('cadence from effort (docs/SPEC.md "Rider animation")', () => {
	it.each([
		[100, 80],
		[137.5, 80],
		[138, 85],
		[187.5, 85],
		[188, 90],
		[225, 90],
		[226, 95],
		[500, 95],
	])('pedals %d W at an FTP of 250 at %d rpm', (watts, rpm) => {
		expect(effortRpm(watts, 250)).toBe(rpm);
	});
});
