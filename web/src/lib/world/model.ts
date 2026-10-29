// The low-poly toolkit every world model is built with (ADR-0092): parts
// coloured flat per face or per part, merged into one geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vertex colours from `color` at the bottom to `top` at the top.
export function tint(
	g: THREE.BufferGeometry,
	color: string,
	top?: string,
): THREE.BufferGeometry {
	const geo = g.index ? g.toNonIndexed() : g;
	const a = new THREE.Color(color);
	const b = new THREE.Color(top ?? color);
	const pos = geo.attributes.position;
	let minY = Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < pos.count; i++) {
		minY = Math.min(minY, pos.getY(i));
		maxY = Math.max(maxY, pos.getY(i));
	}
	const c = new Float32Array(pos.count * 3);
	const t = new THREE.Color();
	for (let i = 0; i < pos.count; i++) {
		t.copy(a).lerp(b, (pos.getY(i) - minY) / (maxY - minY || 1));
		c.set([t.r, t.g, t.b], i * 3);
	}
	geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
	geo.deleteAttribute('uv');
	return geo;
}

/** How far a facet's shade steps from its neighbours', either way: what lets faces read under a light from the sky alone. */
const FACET_STEP = 0.2;

/**
 * One colour per face (ADR-0092): from `from` at `lo` to `to` at `hi` by the
 * height of the face's middle, each face a fixed step lighter or darker by
 * its index. A crown's tiers step from dark to light, and its faces read as
 * facets with no light from the side.
 */
export function facets(
	g: THREE.BufferGeometry,
	from: string,
	to: string,
	lo: number,
	hi: number,
): THREE.BufferGeometry {
	const geo = g.index ? g.toNonIndexed() : g;
	const a = new THREE.Color(from);
	const b = new THREE.Color(to);
	const pos = geo.attributes.position;
	const c = new Float32Array(pos.count * 3);
	const t = new THREE.Color();
	for (let v = 0; v < pos.count; v += 3) {
		const y = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3;
		const k = Math.min(1, Math.max(0, (y - lo) / (hi - lo)));
		const step = (Math.imul(v / 3 + 1, 2654435761) >>> 0) / 2 ** 32;
		t.copy(a)
			.lerp(b, k)
			.multiplyScalar(1 + FACET_STEP * (2 * step - 1));
		for (let i = v; i < v + 3; i++) c.set([t.r, t.g, t.b], i * 3);
	}
	geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
	geo.deleteAttribute('uv');
	return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
	const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
	if (!g) throw new Error('props: parts do not share attributes');
	parts.forEach((p) => p.dispose());
	g.computeVertexNormals();
	return g;
}

export const box = (w: number, h: number, d: number) =>
	new THREE.BoxGeometry(w, h, d);
export const cyl = (top: number, bottom: number, h: number, seg: number) =>
	new THREE.CylinderGeometry(top, bottom, h, seg);
