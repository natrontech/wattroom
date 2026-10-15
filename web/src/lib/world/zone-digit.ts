// The live zone as a digit on the ground ring (#3213, WCAG 1.4.1): the ring's
// colour alone names no zone. One flat plane inside the ring's front end, one
// shared texture per zone, the name tag's ink with its pill's colour as the edge, so it reads on any road.
import * as THREE from 'three';
import { FONT, paintedTexture } from './furniture';
import type { Style } from './styles';

const SIZE = 0.5;
const TEX = 128;

export function makeZoneDigits(tag: Style['tag']) {
	const geo = new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2);
	const textures = new Map<number, THREE.Texture>();
	const textureOf = (zone: number) => {
		let t = textures.get(zone);
		if (!t) {
			t = paintedTexture(TEX, TEX, (x) => {
				x.font = `700 ${TEX * 0.8}px ${FONT}`;
				x.textAlign = 'center';
				x.textBaseline = 'middle';
				x.lineWidth = 8;
				x.strokeStyle = tag.bg;
				x.strokeText(String(zone), TEX / 2, TEX / 2);
				x.fillStyle = tag.ink;
				x.fillText(String(zone), TEX / 2, TEX / 2);
			});
			textures.set(zone, t);
		}
		return t;
	};
	return {
		mesh() {
			return new THREE.Mesh(
				geo,
				new THREE.MeshBasicMaterial({
					transparent: true,
					depthWrite: false,
					polygonOffset: true,
					polygonOffsetFactor: -4,
					polygonOffsetUnits: -8,
				}),
			);
		},
		/** Show `zone`'s digit, or nothing (a silent trainer names no zone). */
		set(
			m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
			zone?: number,
		) {
			m.visible = zone !== undefined;
			if (zone !== undefined && m.userData.zone !== zone) {
				m.userData.zone = zone;
				m.material.map = textureOf(zone);
				m.material.needsUpdate = true;
			}
		},
	};
}
