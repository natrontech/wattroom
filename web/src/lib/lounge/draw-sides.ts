/**
 * The room past its middle (#4302): a bigger page shows more of it. Shelves,
 * lamps, plants, a record crate and a guitar stand along the floor outward
 * from the middle, pictures hang between them, and lights string across the
 * ceiling. Nothing here is clickable; the lamps follow the shared lamp.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { disc, dot, line, rect, ring, type Ctx } from '$lib/lounge/pixel';
import { SCENE_W, pulseOf, type SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

interface Prop {
	w: number;
	/** `x` is its left edge, `floor` the first row of floor. */
	draw(g: Ctx, x: number, floor: number, s: SceneInput, n: number): void;
}

/** A gap between props, so the room reads as furnished rather than packed. */
const GAP = 10;

const shelf: Prop = {
	w: 36,
	draw(g, x, floor, _s, n) {
		const top = floor - 76;
		rect(g, x, top, 36, 76, C.wood);
		rect(g, x + 2, top + 2, 32, 72, C.shelf);
		for (let row = 0; row < 4; row++) {
			const base = top + 2 + (row + 1) * 18 - 2;
			rect(g, x + 2, base, 32, 2, C.woodLight);
			let bx = x + 3;
			for (let k = 0; bx < x + 32; k++) {
				const r = (i: number) => hash3(n * 17 + row, k, i);
				if (r(4) < 0.12) {
					// A gap, or a small plant on the shelf.
					if (r(5) < 0.5) {
						rect(g, bx, base - 5, 5, 5, C.woodLight);
						line(g, bx + 2, base - 5, bx, base - 10, C.leafLight);
						line(g, bx + 2, base - 5, bx + 4, base - 11, C.leaf);
					}
					bx += 7;
					continue;
				}
				const bw = 2 + Math.floor(r(1) * 3);
				const bh = 9 + Math.floor(r(2) * 6);
				const hue = [C.book, C.bookB, C.bookC, C.lilac, C.violet][
					Math.floor(r(3) * 5)
				];
				rect(g, bx, base - bh, Math.min(bw, x + 34 - bx), bh, hue);
				if (bh > 11) rect(g, bx, base - bh + 2, bw, 1, C.paper);
				bx += bw + (r(6) < 0.3 ? 1 : 0);
			}
		}
	},
};

const floorLamp: Prop = {
	w: 16,
	draw(g, x, floor, s) {
		rect(g, x + 3, floor - 2, 10, 2, C.trim);
		rect(g, x + 7, floor - 60, 2, 58, C.trim);
		rect(g, x + 3, floor - 70, 10, 2, C.woodLight);
		rect(g, x + 2, floor - 68, 12, 4, C.woodLight);
		rect(g, x + 1, floor - 64, 14, 2, C.wood);
		if (!s.lampOn) return;
		rect(g, x + 3, floor - 62, 10, 1, C.amber);
		g.globalAlpha = 0.1;
		g.fillStyle = C.amber;
		g.beginPath();
		g.moveTo(x + 2, floor - 62);
		g.lineTo(x + 14, floor - 62);
		g.lineTo(x + 26, floor);
		g.lineTo(x - 10, floor);
		g.closePath();
		g.fill();
		g.globalAlpha = 1;
	},
};

const tallPlant: Prop = {
	w: 22,
	draw(g, x, floor, s, n) {
		const sway = s.still ? 0 : Math.sin(s.t * 0.9 + n);
		for (let i = 0; i < 9; i++) {
			const angle = -1.2 + (i / 8) * 2.4 + (hash3(n, i, 1) - 0.5) * 0.3;
			const length = 18 + hash3(n, i, 2) * 22;
			const tipX =
				x + 11 + Math.sin(angle) * length * 0.7 + sway * (length / 20);
			const tipY = floor - 16 - Math.cos(angle) * length;
			line(g, x + 11, floor - 16, tipX, tipY, i % 2 ? C.leaf : C.leafLight);
			disc(
				g,
				Math.round(tipX),
				Math.round(tipY),
				2,
				i % 2 ? C.leaf : C.leafLight,
			);
		}
		rect(g, x + 4, floor - 16, 14, 16, C.woodLight);
		rect(g, x + 3, floor - 16, 16, 2, C.wood);
		rect(g, x + 4, floor - 9, 14, 1, C.wood);
	},
};

const crate: Prop = {
	w: 30,
	draw(g, x, floor, _s, n) {
		// Sleeves standing in the crate, a little taller than its sides.
		for (let k = 0; k < 8; k++) {
			const hue = [C.bookC, C.teal, C.amber, C.violet, C.bookB, C.lilac][
				Math.floor(hash3(n, k, 7) * 6)
			];
			rect(
				g,
				x + 2 + k * 3,
				floor - 22 - Math.floor(hash3(n, k, 8) * 3),
				3,
				6,
				hue,
			);
		}
		rect(g, x, floor - 18, 30, 18, C.wood);
		rect(g, x, floor - 18, 30, 1, C.woodLight);
		rect(g, x + 2, floor - 10, 26, 1, C.woodLight);
		rect(g, x + 11, floor - 14, 8, 2, C.ink);
	},
};

const guitar: Prop = {
	w: 16,
	draw(g, x, floor) {
		line(g, x + 3, floor, x + 8, floor - 12, C.trim);
		line(g, x + 13, floor, x + 8, floor - 12, C.trim);
		disc(g, x + 8, floor - 13, 6, C.amber);
		disc(g, x + 8, floor - 22, 4, C.amber);
		disc(g, x + 8, floor - 15, 2, C.ink);
		rect(g, x + 7, floor - 46, 2, 26, C.wood);
		rect(g, x + 6, floor - 50, 4, 5, C.wood);
		rect(g, x + 5, floor - 10, 6, 1, C.wood);
	},
};

const LEFT: Prop[] = [shelf, floorLamp, tallPlant, crate, shelf, tallPlant];
const RIGHT: Prop[] = [crate, tallPlant, shelf, guitar, floorLamp, shelf];

/** A small picture: a hill, a bike or a sun, picked by its place on the wall. */
function picture(g: Ctx, x: number, y: number, n: number) {
	const w = 22;
	const h = 16;
	rect(g, x, y, w, h, C.trim);
	rect(g, x + 2, y + 2, w - 4, h - 4, C.poster);
	const kind = Math.floor(hash3(n, 9, 9) * 3);
	if (kind === 0)
		for (let i = 0; i < w - 4; i++) {
			const hill = Math.round(Math.max(0, 7 - Math.abs(i - 9) * 0.8));
			rect(g, x + 2 + i, y + h - 2 - hill, 1, hill, C.book);
		}
	else if (kind === 1) {
		ring(g, x + 7, y + 10, 3, C.lilac);
		ring(g, x + 15, y + 10, 3, C.lilac);
		line(g, x + 7, y + 10, x + 11, y + 6, C.violet);
		line(g, x + 11, y + 6, x + 15, y + 10, C.violet);
	} else {
		disc(g, x + 11, y + 9, 3, C.amber);
		rect(g, x + 2, y + 11, w - 4, 3, C.bookB);
	}
}

/** Bulbs on a wire across the ceiling, glowing softly on the beat. */
function lights(g: Ctx, s: SceneInput) {
	const span = 96;
	const sag = 7;
	const yAt = (x: number) => {
		const f = (((x % span) + span) % span) / span;
		return 3 + Math.round(sag * 4 * f * (1 - f));
	};
	for (let x = 0; x < s.w; x++) dot(g, x, yAt(x), C.cable);
	const glow = pulseOf(s);
	for (let x = 6, k = 0; x < s.w; x += 12, k++) {
		const y = yAt(x) + 1;
		rect(g, x, y, 2, 2, C.bulb);
		const hue = [C.bulb, C.tealLight, C.heart][k % 3];
		g.globalAlpha = s.lampOn ? 0.18 + 0.12 * glow : 0.35;
		disc(g, x, y + 1, 2, hue);
		g.globalAlpha = 1;
	}
}

export function drawSides(g: Ctx, s: SceneInput, ox: number, oy: number) {
	const floor = oy + 160;
	const left = ox;
	const right = ox + SCENE_W;
	for (let px = left - 30, n = 0; px > -22; px -= 48, n++)
		picture(g, px, oy + 30 + (n % 2) * 8, n);
	for (let px = right + 8, n = 0; px < s.w; px += 48, n++)
		picture(g, px, oy + 30 + (n % 2) * 8, n + 50);
	let x = left - 6;
	for (let n = 0; ; n++) {
		const prop = LEFT[n % LEFT.length];
		x -= prop.w;
		if (x + prop.w / 2 < 0) break;
		prop.draw(g, x, floor, s, n);
		x -= GAP;
	}
	x = right + 6;
	for (let n = 0; ; n++) {
		const prop = RIGHT[n % RIGHT.length];
		if (x + prop.w / 2 > s.w) break;
		prop.draw(g, x, floor, s, n + 50);
		x += prop.w + GAP;
	}
	lights(g, s);
}
