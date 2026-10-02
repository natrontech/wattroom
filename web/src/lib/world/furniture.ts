// Signs and the KOM arch: few, so each gets its own board with painted text.
// The set pieces themselves are batched with the props (props/batch.ts).
import * as THREE from 'three';
import { yOf } from './geometry';
import { type Route } from '$lib/road/route';
import type { Arch, Sign } from './setpieces';
import type { Style } from './styles';

const FONT = 'Barlow, system-ui, sans-serif';

type Painting = {
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

function paintedTexture(
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
	g.rotation.y = Math.atan2(sign.turn[1], sign.turn[0]);
	return g;
}

// The KOM arch: ≥ 6 m clear, posts a metre outside the road edge, structural chrome — never glowing.
export function arch(route: Route, a: Arch, style: Style): THREE.Group {
	const text = a.label;
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
	g.position.set(a.x, yOf(route, a.y) + 0.1, a.z);
	g.rotation.y = Math.atan2(a.turn[1], a.turn[0]) + Math.PI;
	return g;
}
