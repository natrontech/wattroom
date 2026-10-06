// The team car and the coach's chevron (#3098): the car tows a resting
// rider back into the bunch, and a coach with no trainer drives it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tag } from './family';
import type { Style } from './styles';

/** Over the car's roof, where the coach's chevron sits while they drive. */
const CHEVRON_CAR_Y = 2.2;

/** A downward chevron, in the plane across the road: seen from the chase camera behind. */
export function chevronGeometry(): THREE.BufferGeometry {
	const s = new THREE.Shape();
	s.moveTo(-0.2, 0.16);
	s.lineTo(0, 0);
	s.lineTo(0.2, 0.16);
	s.lineTo(0.2, 0.07);
	s.lineTo(0, -0.09);
	s.lineTo(-0.2, 0.07);
	s.closePath();
	return new THREE.ShapeGeometry(s);
}

/**
 * The team car (#3098): a box saloon in the kit's white, its wheels in the
 * tyre's black, one draw each. It tows a rider back in, and a coach with no
 * trainer drives it — then it wears their chevron on its roof.
 * ponytail: two boxes and four drums; a modelled car when the figure is (#3673).
 */
export function makeCar(
	style: Style,
	gradient: THREE.Texture,
	chevronGeo: THREE.BufferGeometry,
	chevronMat: THREE.MeshBasicMaterial,
) {
	const parts = [
		new THREE.BoxGeometry(1.8, 0.7, 4.5).translate(0, 0.65, 0),
		new THREE.BoxGeometry(1.6, 0.55, 2.3).translate(0, 1.27, -0.3),
	];
	const drum = (x: number, z: number) =>
		new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14)
			.rotateZ(Math.PI / 2)
			.translate(x, 0.33, z);
	const drums = [
		drum(-0.84, 1.45),
		drum(0.84, 1.45),
		drum(-0.84, -1.45),
		drum(0.84, -1.45),
	];
	const body = mergeGeometries(parts);
	const wheels = mergeGeometries(drums);
	[...parts, ...drums].forEach((g) => g.dispose());
	const paintIn = (color: string) => {
		const m = new THREE.MeshToonMaterial({
			color: new THREE.Color(color),
			gradientMap: gradient,
			alphaHash: true,
		});
		return m;
	};
	const bodyMat = paintIn(style.kit.shoe);
	const wheelMat = paintIn(style.kit.tyre);
	const chevron = new THREE.Mesh(chevronGeo, chevronMat);
	chevron.position.y = CHEVRON_CAR_Y;
	const group = new THREE.Group();
	group.add(
		tag('figures', new THREE.Mesh(body, bodyMat), 'car'),
		tag('figures', new THREE.Mesh(wheels, wheelMat), 'car'),
		tag('marks', chevron, 'chevron'),
	);
	group.visible = false;
	return {
		group,
		set(alpha: number, coach: boolean) {
			bodyMat.opacity = wheelMat.opacity = chevronMat.opacity = alpha;
			chevron.visible = coach;
		},
	};
}
