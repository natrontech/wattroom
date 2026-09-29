// Low-poly prop models built in code: each is one merged geometry with vertex
// colours, so a whole forest is one instanced draw call. Proportions are
// chunky on purpose — they read at 30 m from a chase camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropColors } from './styles';

// Vertex colours from `color` at the bottom to `top` at the top.
function tint(
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

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
	const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
	if (!g) throw new Error('props: parts do not share attributes');
	parts.forEach((p) => p.dispose());
	g.computeVertexNormals();
	return g;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (top: number, bottom: number, h: number, seg: number) =>
	new THREE.CylinderGeometry(top, bottom, h, seg);

// A spruce: three stacked cones, slightly offset so it never looks stamped.
export function spruce(c: PropColors) {
	return merge([
		tint(cyl(0.35, 0.5, 3, 5).translate(0, 1.5, 0), c.trunk),
		tint(
			new THREE.ConeGeometry(4.2, 7, 7).translate(0, 5.5, 0),
			c.spruce,
			c.spruceTip,
		),
		tint(
			new THREE.ConeGeometry(3.3, 6, 7).rotateY(0.4).translate(0.1, 9, 0),
			c.spruce,
			c.spruceTip,
		),
		tint(
			new THREE.ConeGeometry(2.2, 5, 7)
				.rotateY(0.9)
				.translate(-0.1, 12.4, 0.05),
			c.spruce,
			c.spruceTip,
		),
	]);
}

function leafBlob(
	c: PropColors,
	detail: number,
	r: number,
	x: number,
	y: number,
	z: number,
) {
	const g = new THREE.IcosahedronGeometry(r, detail);
	g.scale(1, 0.85, 1);
	return tint(g.translate(x, y, z), c.leaf, c.leafLight);
}

// A broadleaf: a trunk and two lumpy blobs.
export function broadleaf(c: PropColors) {
	return merge([
		tint(cyl(0.3, 0.45, 4.5, 5).translate(0, 2.25, 0), c.trunk),
		leafBlob(c, 0, 3.6, 0, 6.6, 0),
		leafBlob(c, 0, 2.6, 1.6, 8.2, -0.8),
		leafBlob(c, 0, 2.2, -1.5, 7.8, 1),
	]);
}

// A tall broadleaf to stand beside a chapel — the landmark that reads against the sky.
export function linden(c: PropColors) {
	return merge([
		tint(cyl(0.5, 0.8, 7, 7).translate(0, 3.5, 0), c.trunk),
		leafBlob(c, 1, 5.5, 0, 11, 0),
		leafBlob(c, 1, 4, 3, 13, -1.5),
		leafBlob(c, 1, 3.6, -2.6, 12.5, 1.8),
	]);
}

// A gabled roof as an extruded triangle.
function roof(w: number, d: number, h: number, overhang: number) {
	const s = new THREE.Shape();
	s.moveTo(-w / 2 - overhang, 0);
	s.lineTo(0, h);
	s.lineTo(w / 2 + overhang, 0);
	s.lineTo(-w / 2 - overhang, 0);
	const g = new THREE.ExtrudeGeometry(s, {
		depth: d + overhang * 2,
		bevelEnabled: false,
	});
	return g.translate(0, 0, -(d + overhang * 2) / 2);
}

// Buildings stand on a stone base that reaches 3 m into the ground, so a
// house on a slope sits on its foundation instead of floating off a corner.
const foundation = (w: number, d: number, c: PropColors) =>
	tint(box(w, 3.4, d).translate(0, -1.4, 0), c.stone);

// A Swiss house: white masonry ground floor, timber upper floor, deep eaves.
export function house(c: PropColors) {
	return merge([
		foundation(9.3, 11.3, c),
		tint(box(9, 3.2, 11).translate(0, 1.6, 0), c.wall),
		tint(box(9.2, 2.8, 11.2).translate(0, 4.6, 0), c.wood),
		tint(roof(9.2, 11.2, 4.2, 1.4).translate(0, 6, 0), c.roof),
		tint(box(0.9, 2, 0.9).translate(2.2, 9.4, 1.5), c.stone),
	]);
}

// A Reformed church: nave, tall square tower, needle spire.
export function church(c: PropColors) {
	return merge([
		foundation(10.3, 29, c),
		tint(box(10, 7, 18).translate(0, 3.5, 2), c.wall),
		tint(roof(10, 18, 5, 0.6).translate(0, 7, 2), c.roof),
		tint(box(4.6, 16, 4.6).translate(0, 8, -8.5), c.wall),
		tint(
			new THREE.ConeGeometry(3.4, 11, 4)
				.rotateY(Math.PI / 4)
				.translate(0, 21.5, -8.5),
			c.roof,
		),
	]);
}

export function barn(c: PropColors) {
	return merge([
		foundation(12.2, 18.2, c),
		tint(box(12, 5, 18).translate(0, 2.5, 0), c.wood),
		tint(roof(12, 18, 5.5, 1.2).translate(0, 5, 0), c.roof),
	]);
}

// An alpine hut: stone plinth, timber box, heavy low roof.
export function hut(c: PropColors) {
	return merge([
		foundation(7.2, 8.2, c),
		tint(box(7, 1.6, 8).translate(0, 0.8, 0), c.stone),
		tint(box(6.6, 2.6, 7.6).translate(0, 2.9, 0), c.wood),
		tint(roof(6.6, 7.6, 2.4, 1).translate(0, 4.2, 0), c.stone),
	]);
}

export function chapel(c: PropColors) {
	return merge([
		foundation(5.2, 8.2, c),
		tint(box(5, 4.2, 8).translate(0, 2.1, 0), c.wall),
		tint(roof(5, 8, 3, 0.4).translate(0, 4.2, 0), c.roof),
		tint(box(1.4, 2.2, 1.4).translate(0, 7.7, 3.2), c.wall),
		tint(
			new THREE.ConeGeometry(1.1, 2.8, 4)
				.rotateY(Math.PI / 4)
				.translate(0, 10.2, 3.2),
			c.roof,
		),
	]);
}

export function cow(c: PropColors) {
	const leg = (x: number, z: number) =>
		tint(box(0.28, 0.8, 0.28).translate(x, 0.4, z), c.cow);
	return merge([
		tint(box(1.1, 1.0, 2.1).translate(0, 1.25, 0), c.cow),
		tint(box(1.12, 0.6, 0.9).translate(0, 1.4, -0.3), c.cowPatch),
		tint(box(0.6, 0.6, 0.7).translate(0, 1.55, 1.25), c.cow),
		tint(box(0.34, 0.2, 0.2).translate(0, 1.1, 1.3), c.bell),
		leg(-0.35, -0.75),
		leg(0.35, -0.75),
		leg(-0.35, 0.75),
		leg(0.35, 0.75),
	]);
}

export function rock(c: PropColors) {
	const g = new THREE.DodecahedronGeometry(1.4, 0);
	g.scale(1.3, 0.7, 1);
	return merge([tint(g.translate(0, 0.35, 0), c.rock)]);
}

// --- set-piece kits: small things that make a road a place -------------------

export function bench(c: PropColors) {
	return merge([
		tint(box(1.8, 0.08, 0.45).translate(0, 0.45, 0), c.wood),
		tint(box(1.8, 0.4, 0.06).translate(0, 0.75, -0.22), c.wood),
		tint(box(0.08, 0.45, 0.4).translate(-0.8, 0.22, 0), c.trunk),
		tint(box(0.08, 0.45, 0.4).translate(0.8, 0.22, 0), c.trunk),
	]);
}

export function woodpile(c: PropColors) {
	const logs: THREE.BufferGeometry[] = [];
	for (let r = 0; r < 4; r++)
		for (let k = 0; k < 6 - r; k++)
			logs.push(
				tint(
					cyl(0.16, 0.16, 1.1, 6)
						.rotateX(Math.PI / 2)
						.translate((k - (5 - r) / 2) * 0.33, 0.16 + r * 0.29, 0),
					k % 2 ? c.wood : c.trunk,
				),
			);
	logs.push(tint(box(2.3, 0.08, 1.4).translate(0, 1.4, 0), c.roof));
	return merge(logs);
}

export function bales(c: PropColors) {
	const b = (x: number, z: number) =>
		tint(
			cyl(0.75, 0.75, 1.2, 12)
				.rotateZ(Math.PI / 2)
				.translate(x, 0.75, z),
			c.bale,
			c.baleLight,
		);
	return merge([b(0, 0), b(1.5, 0.6), b(0.6, 1.9)]);
}

export function wayside(c: PropColors) {
	return merge([
		tint(box(0.7, 0.5, 0.5).translate(0, 0.25, 0), c.stone),
		tint(box(0.14, 2.4, 0.14).translate(0, 1.4, 0), c.wood),
		tint(box(1.0, 0.13, 0.14).translate(0, 2.0, 0), c.wood),
		tint(roof(0.8, 0.5, 0.35, 0.1).translate(0, 2.55, 0), c.roof),
	]);
}

// The yellow Swiss hiking signpost.
export function signpost(c: PropColors) {
	return merge([
		tint(cyl(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), c.pole),
		tint(box(0.9, 0.2, 0.04).translate(0.35, 2.3, 0), c.hiking),
		tint(box(0.9, 0.2, 0.04).rotateY(2.2).translate(-0.3, 2.0, 0.2), c.hiking),
		tint(box(0.3, 0.3, 0.04).translate(0, 2.6, 0.03), c.post),
	]);
}

export function fountain(c: PropColors) {
	return merge([
		tint(box(2.6, 0.7, 1.1).translate(0, 0.35, 0), c.stone),
		tint(box(2.3, 0.1, 0.8).translate(0, 0.66, 0), c.water),
		tint(box(0.3, 1.5, 0.3).translate(-1.4, 0.75, 0), c.stone),
		tint(
			cyl(0.03, 0.03, 0.5, 4)
				.rotateZ(Math.PI / 2)
				.translate(-1.05, 1.25, 0),
			c.pole,
		),
	]);
}

export function fence(c: PropColors) {
	const parts: THREE.BufferGeometry[] = [];
	for (let k = 0; k <= 5; k++)
		parts.push(tint(box(0.1, 1.1, 0.1).translate(k * 2 - 5, 0.55, 0), c.trunk));
	for (const y of [0.45, 0.9])
		parts.push(tint(box(10, 0.07, 0.05).translate(0, y, 0), c.wood));
	return merge(parts);
}

export function flagpole(c: PropColors, flag: string) {
	return merge([
		tint(cyl(0.05, 0.06, 8, 6).translate(0, 4, 0), c.pole),
		tint(box(1.6, 1.0, 0.02).translate(0.85, 7.3, 0), flag),
	]);
}

// Snow poles: 2.5 m, the rhythm that says you are high up.
export function snowpole(c: PropColors) {
	return merge([
		tint(cyl(0.04, 0.04, 2.5, 5).translate(0, 1.25, 0), c.snowpole, c.band),
	]);
}

// The Swiss delineator: white round post, black band, reflector.
export function delineator(c: PropColors) {
	return merge([
		tint(cyl(0.07, 0.07, 1.0, 8).translate(0, 0.5, 0), c.post),
		tint(cyl(0.075, 0.075, 0.2, 8).translate(0, 0.78, 0), c.band),
		tint(box(0.06, 0.12, 0.05).translate(0, 0.78, -0.07), c.reflector),
	]);
}
