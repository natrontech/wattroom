// Signs and the KOM arch: their painted faces and the arch's shape. The ride
// draws them batched (boards.ts); the set pieces batch with the props (props/batch.ts).
import * as THREE from 'three';
import { yOf } from './geometry';
import { type Route } from '$lib/road/route';
import type { Arch, Sign } from './setpieces';
import type { Style } from './styles';

export const FONT = 'Barlow, system-ui, sans-serif';

export type Painting = {
	cv: OffscreenCanvas | HTMLCanvasElement;
	x: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
};

// An OffscreenCanvas where the browser has one (Safari only since 16.4), a
// detached DOM canvas where it does not: a sign is never why the world fails.
function canvas2d(w: number, h: number): Painting {
	if (typeof OffscreenCanvas === 'function') {
		const cv = new OffscreenCanvas(w, h);
		return { cv, x: cv.getContext('2d') };
	}
	const cv = document.createElement('canvas');
	cv.width = w;
	cv.height = h;
	return { cv, x: cv.getContext('2d') };
}

export function paintedTexture(
	w: number,
	h: number,
	draw: (x: NonNullable<Painting['x']>) => void,
): THREE.CanvasTexture<Painting['cv']> {
	const { cv, x } = canvas2d(w, h);
	if (x) draw(x);
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/** A sign's face, painted at W × H, the board's own proportions at 512 wide. */
export function paintSign(
	x: NonNullable<Painting['x']>,
	sign: Sign,
	look: Style['signs'][Sign['look']],
	W: number,
	H: number,
) {
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
}

/** The arch's banner, painted at ARCH_PAINT's size. */
export const ARCH_PAINT = [1024, 160] as const;
export function paintArch(
	x: NonNullable<Painting['x']>,
	text: string,
	style: Style,
) {
	const [W, H] = ARCH_PAINT;
	x.fillStyle = style.arch.panel;
	x.fillRect(0, 0, W, H);
	x.fillStyle = style.arch.stripe;
	x.fillRect(0, 0, W, 10);
	x.fillRect(0, H - 10, W, 10);
	x.fillStyle = style.arch.text;
	x.font = `bold 96px "Chakra Petch", ${FONT}`;
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	x.fillText(text, W / 2, 84);
}

// The KOM arch: ≥ 6 m clear, posts a metre outside the road edge, structural chrome — never glowing.
type Box = readonly [
	at: [number, number, number],
	size: [number, number, number],
];
/** Its chrome in its own frame, centre and size: two posts, and the banner painted front and back. */
export const ARCH_POSTS: readonly Box[] = [
	[
		[-4.4, 3.8, 0],
		[0.5, 7.6, 0.5],
	],
	[
		[4.4, 3.8, 0],
		[0.5, 7.6, 0.5],
	],
];
export const ARCH_BANNER: Box = [
	[0, 7.0, 0],
	[9.4, 1.4, 0.3],
];

/** The arch as one moving group, for a game's finish (game-road.ts); the ride's arches are batched (boards.ts). */
export function arch(route: Route, a: Arch, style: Style): THREE.Group {
	const g = new THREE.Group();
	const chrome = new THREE.MeshLambertMaterial({ color: style.arch.chrome });
	const tex = paintedTexture(...ARCH_PAINT, (x) =>
		paintArch(x, a.label, style),
	);
	const face = new THREE.MeshLambertMaterial({ map: tex });
	const box = ([at, size]: Box, m: THREE.Material | THREE.Material[]) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), m);
		mesh.position.set(...at);
		g.add(mesh);
	};
	for (const p of ARCH_POSTS) box(p, chrome);
	box(ARCH_BANNER, [chrome, chrome, chrome, chrome, face, face]);
	g.position.set(a.x, yOf(route, a.y) + 0.1, a.z);
	g.rotation.y = Math.atan2(a.turn[1], a.turn[0]) + Math.PI;
	return g;
}
