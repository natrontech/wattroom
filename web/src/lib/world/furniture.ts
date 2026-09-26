// Set pieces, signs and the KOM arch. Kits are instanced by kind; signs and
// arches are few, so each gets its own board with painted text.
import * as THREE from 'three';
import { yOf } from './geometry';
import * as P from './props';
import { at, type Route } from './route';
import type { Piece, PieceKind, Sign } from './setpieces';
import type { PropColors, Style } from './styles';
import type { World } from './world';

type Kits = Record<
	Exclude<PieceKind, 'flag'>,
	(c: PropColors) => THREE.BufferGeometry
>;
const KITS: Kits = {
	bench: P.bench,
	woodpile: P.woodpile,
	bales: P.bales,
	wayside: P.wayside,
	signpost: P.signpost,
	fountain: P.fountain,
	fence: P.fence,
	linden: P.linden,
	chapel: P.chapel,
	snowpole: P.snowpole,
	delineator: P.delineator,
	house: P.house,
	barn: P.barn,
	hut: P.hut,
	cow: P.cow,
};
// Low kits never block (≤ 2 m under a 4.4 m eye): no fade.
const LOW = new Set<PieceKind>([
	'bench',
	'woodpile',
	'bales',
	'fence',
	'delineator',
	'snowpole',
	'cow',
	'fountain',
	'wayside',
	'signpost',
	'flag',
]);
const ROADSIDE = new Set<PieceKind>(['delineator', 'snowpole']);

export type KitMaterials = {
	fade: THREE.Material; // buildings that may stand in the sightline
	leafy: THREE.Material; // a linden sways and fades
	flat: THREE.Material; // everything low
};

export function kits(
	route: Route,
	world: World,
	c: PropColors,
	mats: KitMaterials,
): THREE.InstancedMesh[] {
	const groups = new Map<string, Piece[]>();
	for (const p of world.pieces) {
		const k = p.kind === 'flag' ? c.flags[p.flag ?? 0] : p.kind;
		const list = groups.get(k);
		if (list) list.push(p);
		else groups.set(k, [p]);
	}
	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const one = new THREE.Vector3(1, 1, 1);
	const up = new THREE.Vector3(0, 1, 0);
	const v = new THREE.Vector3();
	return [...groups.values()].map((list) => {
		const kind = list[0].kind;
		const geo =
			kind === 'flag'
				? P.flagpole(c, c.flags[list[0].flag ?? 0])
				: KITS[kind](c);
		const mat =
			kind === 'linden' ? mats.leafy : LOW.has(kind) ? mats.flat : mats.fade;
		const im = new THREE.InstancedMesh(geo, mat, list.length);
		const sink = ROADSIDE.has(kind) ? 0.05 : 0.15;
		list.forEach((p, i) => {
			q.setFromAxisAngle(up, p.rot);
			v.set(p.x, yOf(route, p.y) - sink, p.z);
			im.setMatrixAt(i, m4.compose(v, q, one));
		});
		im.computeBoundingSphere();
		return im;
	});
}

const FONT = 'Barlow, system-ui, sans-serif';

function paintedTexture(
	w: number,
	h: number,
	draw: (x: OffscreenCanvasRenderingContext2D) => void,
): THREE.CanvasTexture<OffscreenCanvas> {
	const cv = new OffscreenCanvas(w, h);
	const x = cv.getContext('2d');
	if (x) draw(x);
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

export function board(route: Route, sign: Sign, style: Style): THREE.Group {
	const look = style.signs[sign.look];
	const W = 512;
	const H = Math.round((W * sign.h) / sign.w);
	const tex = paintedTexture(W, H, (x) => {
		x.fillStyle = look.bg;
		x.fillRect(0, 0, W, H);
		x.strokeStyle = look.fg;
		x.lineWidth = 8;
		x.strokeRect(10, 10, W - 20, H - 20);
		x.fillStyle = look.fg;
		x.textAlign = 'center';
		x.textBaseline = 'middle';
		const lh = H / (sign.lines.length + 0.6);
		sign.lines.forEach((l, i) => {
			const size = Math.min(lh * 0.72, (W * 1.6) / Math.max(4, l.length));
			x.font = `bold ${size}px ${FONT}`;
			x.fillText(l, W / 2, lh * (i + 0.8));
		});
	});
	const post = new THREE.MeshLambertMaterial({ color: look.post });
	const face = new THREE.MeshLambertMaterial({ map: tex });
	const g = new THREE.Group();
	const panel = new THREE.Mesh(new THREE.BoxGeometry(sign.w, sign.h, 0.06), [
		post,
		post,
		post,
		post,
		face,
		post,
	]);
	const legH = sign.look === 'hairpin' ? 1.0 : 1.4;
	panel.position.y = legH + sign.h / 2;
	g.add(panel);
	const legs = sign.look === 'hairpin' ? [0] : [-sign.w * 0.38, sign.w * 0.38];
	for (const sx of legs) {
		const leg = new THREE.Mesh(
			new THREE.CylinderGeometry(0.04, 0.04, legH + sign.h * 0.6, 6),
			post,
		);
		leg.position.set(sx, (legH + sign.h * 0.6) / 2, -0.05);
		g.add(leg);
	}
	g.position.set(sign.x, yOf(route, sign.y) - 0.1, sign.z);
	g.rotation.y = sign.rot;
	return g;
}

// The KOM arch: ≥ 6 m clear, posts a metre outside the road edge, structural chrome — never glowing.
export function arch(
	route: Route,
	d: number,
	text: string,
	style: Style,
): THREE.Group {
	const p = at(route, d);
	const g = new THREE.Group();
	const chrome = new THREE.MeshLambertMaterial({ color: style.arch.chrome });
	for (const sx of [-4.4, 4.4]) {
		const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.6, 0.5), chrome);
		post.position.set(sx, 3.8, 0);
		g.add(post);
	}
	const tex = paintedTexture(1024, 160, (x) => {
		x.fillStyle = style.arch.panel;
		x.fillRect(0, 0, 1024, 160);
		x.fillStyle = style.arch.stripe;
		x.fillRect(0, 0, 1024, 10);
		x.fillRect(0, 150, 1024, 10);
		x.fillStyle = style.arch.text;
		x.font = `bold 96px "Chakra Petch", ${FONT}`;
		x.textAlign = 'center';
		x.textBaseline = 'middle';
		x.fillText(text, 512, 84);
	});
	const face = new THREE.MeshLambertMaterial({ map: tex });
	const banner = new THREE.Mesh(new THREE.BoxGeometry(9.4, 1.4, 0.3), [
		chrome,
		chrome,
		chrome,
		chrome,
		face,
		face,
	]);
	banner.position.y = 7.0;
	g.add(banner);
	g.position.set(p.x, yOf(route, p.ele) + 0.1, p.z);
	g.rotation.y = p.heading + Math.PI;
	return g;
}
