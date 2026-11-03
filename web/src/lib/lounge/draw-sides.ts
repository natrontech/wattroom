/**
 * The room past its stage (#4302): a bigger page shows more of it. Shelves,
 * lamps, plants, a record crate and a guitar stand against the back wall
 * outward from the stage, and pictures hang between them; all of it holds
 * still and is drawn once with the room (drawBack). Lights string across the
 * ceiling and step on the beat (drawLights). Nothing here is clickable; the
 * lamps follow the shared lamp.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import {
	disc,
	ellipse,
	line,
	outlined,
	pool,
	rect,
	ring,
	type Ctx,
} from '$lib/lounge/pixel';
import { FLOOR_Y, SCENE_W, pulseOf, type SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

interface Prop {
	w: number;
	/** `x` is its left edge, `base` the floor row it stands on. */
	draw(g: Ctx, x: number, base: number, lampOn: boolean, n: number): void;
}

/** A gap between props, so the room reads as furnished rather than packed. */
const GAP = 10;

const shelf: Prop = {
	w: 36,
	draw(g, x, base, _lampOn, n) {
		const top = base - 76;
		rect(g, x, base + 1, 36, 1, C.floorDark);
		outlined(g, [[x, top, 36, 76, C.wood]], C.ink);
		rect(g, x, top, 36, 1, C.woodTop);
		rect(g, x + 2, top + 2, 32, 72, C.shelf);
		for (let row = 0; row < 4; row++) {
			const floor = top + 2 + (row + 1) * 18 - 2;
			rect(g, x + 2, floor, 32, 2, C.woodLight);
			let bx = x + 3;
			for (let k = 0; bx < x + 32; k++) {
				const r = (i: number) => hash3(n * 17 + row, k, i);
				if (r(4) < 0.12) {
					// A gap, or a small plant on the shelf.
					if (r(5) < 0.5) {
						rect(g, bx, floor - 5, 5, 5, C.woodLight);
						line(g, bx + 2, floor - 5, bx, floor - 10, C.leafLight);
						line(g, bx + 2, floor - 5, bx + 4, floor - 11, C.leaf);
					}
					bx += 7;
					continue;
				}
				const bw = 2 + Math.floor(r(1) * 3);
				const bh = 9 + Math.floor(r(2) * 6);
				const hue = [C.book, C.bookB, C.bookC, C.lilac, C.violet][
					Math.floor(r(3) * 5)
				];
				rect(g, bx, floor - bh, Math.min(bw, x + 34 - bx), bh, hue);
				if (bh > 11) rect(g, bx, floor - bh + 2, bw, 1, C.paper);
				bx += bw + (r(6) < 0.3 ? 1 : 0);
			}
		}
	},
};

const floorLamp: Prop = {
	w: 16,
	draw(g, x, base, lampOn) {
		if (lampOn) {
			pool(g, x + 8, base - 50, 18, 22, C.litWall, 0.55);
			pool(g, x + 8, base + 6, 20, 5, C.litFloor, 0.7);
		}
		ellipse(g, x + 8, base, 6, 1, C.floorDark);
		outlined(
			g,
			[
				[x + 3, base - 2, 10, 2, C.trim],
				[x + 7, base - 60, 2, 58, C.trim],
				[x + 2, base - 70, 12, 8, C.woodLight],
			],
			C.ink,
		);
		rect(g, x + 2, base - 70, 12, 1, C.woodTop);
		rect(g, x + 2, base - 64, 12, 2, C.wood);
		if (lampOn) rect(g, x + 3, base - 61, 10, 1, C.amber);
	},
};

const tallPlant: Prop = {
	w: 22,
	draw(g, x, base, _lampOn, n) {
		ellipse(g, x + 11, base, 9, 1, C.floorDark);
		for (let i = 0; i < 9; i++) {
			const angle = -1.2 + (i / 8) * 2.4 + (hash3(n, i, 1) - 0.5) * 0.3;
			const length = 18 + hash3(n, i, 2) * 22;
			const tipX = x + 11 + Math.sin(angle) * length * 0.7;
			const tipY = base - 16 - Math.cos(angle) * length;
			const hue = i % 2 ? C.leaf : C.leafLight;
			line(g, x + 11, base - 16, tipX, tipY, hue);
			disc(g, Math.round(tipX), Math.round(tipY), 2, hue);
		}
		outlined(g, [[x + 4, base - 16, 14, 16, C.woodLight]], C.ink);
		rect(g, x + 3, base - 16, 16, 2, C.wood);
		rect(g, x + 14, base - 14, 4, 14, C.wood);
	},
};

const crate: Prop = {
	w: 30,
	draw(g, x, base, _lampOn, n) {
		rect(g, x, base + 1, 30, 1, C.floorDark);
		// Sleeves standing in the crate, a little taller than its sides.
		for (let k = 0; k < 8; k++) {
			const hue = [C.bookC, C.teal, C.amber, C.violet, C.bookB, C.lilac][
				Math.floor(hash3(n, k, 7) * 6)
			];
			rect(
				g,
				x + 2 + k * 3,
				base - 22 - Math.floor(hash3(n, k, 8) * 3),
				3,
				6,
				hue,
			);
		}
		outlined(g, [[x, base - 18, 30, 18, C.wood]], C.ink);
		rect(g, x, base - 18, 30, 1, C.woodLight);
		rect(g, x + 2, base - 10, 26, 1, C.woodLight);
		rect(g, x + 11, base - 14, 8, 2, C.ink);
	},
};

const guitar: Prop = {
	w: 16,
	draw(g, x, base) {
		line(g, x + 3, base, x + 8, base - 12, C.trim);
		line(g, x + 13, base, x + 8, base - 12, C.trim);
		disc(g, x + 8, base - 13, 7, C.ink);
		disc(g, x + 8, base - 22, 5, C.ink);
		disc(g, x + 8, base - 13, 6, C.amber);
		disc(g, x + 8, base - 22, 4, C.amber);
		disc(g, x + 8, base - 15, 2, C.ink);
		outlined(
			g,
			[
				[x + 7, base - 46, 2, 26, C.wood],
				[x + 6, base - 50, 4, 5, C.wood],
			],
			C.ink,
		);
		rect(g, x + 5, base - 10, 6, 1, C.wood);
	},
};

const LEFT: Prop[] = [shelf, floorLamp, tallPlant, crate, shelf, tallPlant];
const RIGHT: Prop[] = [crate, tallPlant, shelf, guitar, floorLamp, shelf];

/** A small picture: a hill, a bike or a sun, picked by its place on the wall. */
function picture(g: Ctx, x: number, y: number, n: number) {
	const w = 22;
	const h = 16;
	outlined(g, [[x, y, w, h, C.trim]], C.ink);
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

/** The props left and right of the stage, in room pixels. */
export function paintSides(g: Ctx, s: SceneInput, ox: number, oy: number) {
	const base = oy + FLOOR_Y + 4;
	const left = ox;
	const right = ox + SCENE_W;
	for (let px = left - 30, n = 0; px > -22; px -= 48, n++)
		picture(g, px, oy + 18 + (n % 2) * 8, n);
	for (let px = right + 8, n = 0; px < s.w; px += 48, n++)
		picture(g, px, oy + 18 + (n % 2) * 8, n + 50);
	let x = left - 4;
	for (let n = 0; ; n++) {
		const prop = LEFT[n % LEFT.length];
		x -= prop.w;
		if (x + prop.w / 2 < 0) break;
		prop.draw(g, x, base, s.lampOn, n);
		x -= GAP;
	}
	x = right + 4;
	for (let n = 0; ; n++) {
		const prop = RIGHT[n % RIGHT.length];
		if (x + prop.w / 2 > s.w) break;
		prop.draw(g, x, base, s.lampOn, n + 50);
		x += prop.w + GAP;
	}
}

/**
 * Bulbs on a wire across the ceiling. On the beat a bulb's top pixel steps
 * to white: a colour change a pixel wide, never a glow or a flash.
 */
export function drawLights(g: Ctx, s: SceneInput) {
	const span = 96;
	const sag = 5;
	const yAt = (x: number) => {
		const f = (((x % span) + span) % span) / span;
		return 2 + Math.round(sag * 4 * f * (1 - f));
	};
	for (let x = 0; x < s.w; x++) rect(g, x, yAt(x), 1, 1, C.cable);
	const lit = s.lampOn && pulseOf(s) > 0.7;
	const hues =
		s.season === 'winter'
			? [C.heart, C.leafLight, C.bulb]
			: [C.bulb, C.tealLight, C.heart];
	for (let x = 6, k = 0; x < s.w; x += 12, k++) {
		const y = yAt(x) + 1;
		outlined(g, [[x, y, 2, 3, hues[k % 3]]], C.ink);
		if (lit && k % 2 === Math.floor(s.beat) % 2) rect(g, x, y, 1, 1, C.star);
	}
}
