/**
 * The room's furniture: walls and the rug in front, the sign that moves to
 * the music, the cuckoo clock, the desk and lamp, the record player and its
 * speaker, and the dark that falls when the lamp is off.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { disc, dot, line, rect, ring, type Ctx } from '$lib/lounge/pixel';
import type { Sky } from '$lib/lounge/palette';
import { SCENE_H, pulseOf, type SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

/** The sign's five bars trace the equalizer W (ADR-0005). */
const SIGN_BARS = [26, 12, 20, 12, 26];

/**
 * Wall, wainscot and floor across the whole room. They change only with its
 * size and the theme, and the wallpaper alone is a thousand pixels, so they
 * are drawn once onto a canvas of their own.
 */
let walls: { key: string; canvas: HTMLCanvasElement } | undefined;

export function forgetWalls() {
	walls = undefined;
}

export function drawWalls(g: Ctx, s: SceneInput, oy: number) {
	const key = `${s.w}x${s.h}`;
	if (walls?.key !== key) {
		const canvas = document.createElement('canvas');
		canvas.width = s.w;
		canvas.height = s.h;
		paintWalls(canvas.getContext('2d')!, s.w, s.h, oy);
		walls = { key, canvas };
	}
	g.drawImage(walls.canvas, 0, 0);
}

function paintWalls(g: Ctx, w: number, h: number, oy: number) {
	const floor = oy + 160;
	rect(g, 0, 0, w, floor, C.wall);
	// Wallpaper: a small diamond on a staggered grid, one step off the wall.
	for (let y = 6, row = 0; y < floor - 36; y += 10, row++)
		for (let x = (row % 2) * 8 + 4; x < w; x += 16) {
			dot(g, x, y - 1, C.wainscot);
			rect(g, x - 1, y, 3, 1, C.wainscot);
			dot(g, x, y + 1, C.wainscot);
		}
	rect(g, 0, floor - 32, w, 32, C.wainscot);
	rect(g, 0, floor - 33, w, 1, C.trim);
	rect(g, 0, floor - 30, w, 1, C.sillTop);
	for (let x = 12; x < w; x += 40) {
		rect(g, x, floor - 26, 28, 1, C.trim);
		rect(g, x, floor - 26, 1, 22, C.trim);
	}
	rect(g, 0, floor - 2, w, 2, C.trim);
	rect(g, 0, floor, w, h - floor, C.floor);
	for (let y = floor + 3; y < h; y += 5) rect(g, 0, y, w, 1, C.plank);
	for (let y = floor, k = 0; y < h; y += 5, k++)
		for (let x = (k % 2) * 20; x < w; x += 40) {
			rect(g, x, y, 1, 5, C.plank);
			// Grain: one darker run in some boards.
			if (hash3(x, y, 3) > 0.6) rect(g, x + 6, y + 2, 9, 1, C.plank);
		}
	front(g, w, oy + SCENE_H);
}

/** The rug the cushions sit on, and a helmet and a bottle left by the bike. */
function front(g: Ctx, w: number, top: number) {
	const half = Math.min(150, Math.floor(w / 2) - 6);
	const x0 = Math.floor(w / 2) - half;
	rect(g, x0, top + 6, half * 2, 26, C.cushion);
	rect(g, x0 + 2, top + 8, half * 2 - 4, 22, C.rug);
	for (let x = x0 + 6; x < x0 + half * 2 - 4; x += 8) {
		dot(g, x, top + 11, C.lilac);
		rect(g, x - 1, top + 12, 3, 1, C.lilac);
		dot(g, x, top + 13, C.lilac);
		dot(g, x + 4, top + 26, C.cushion);
	}
	// A helmet and a bottle by the bike.
	const mid = Math.floor(w / 2);
	disc(g, mid + 54, top + 2, 4, C.teal);
	rect(g, mid + 50, top + 2, 9, 3, C.floor);
	rect(g, mid + 50, top + 2, 9, 1, C.tealLight);
	rect(g, mid + 64, top - 6, 3, 7, C.bookB);
	rect(g, mid + 65, top - 7, 1, 1, C.paper);
}

export function drawRoom(g: Ctx, s: SceneInput) {
	sign(g, s);
	clock(g, s);
	poster(g);
	plant(g, s);
	desk(g, s);
	deck(g, s);
}

function sign(g: Ctx, s: SceneInput) {
	rect(g, 20, 24, 74, 36, C.poster);
	rect(g, 20, 24, 74, 1, C.trim);
	rect(g, 20, 59, 74, 1, C.trim);
	SIGN_BARS.forEach((tall, i) => {
		const level = pulseOf({ ...s, beat: s.beat + i * 0.13, t: s.t + i });
		const h = Math.max(3, Math.round(tall * (0.55 + 0.45 * level)));
		rect(g, 30 + i * 12, 55 - h, 8, h, C.teal);
		rect(g, 30 + i * 12, 55 - h, 8, 1, C.tealLight);
	});
}

/** A cuckoo clock: on the hour, or when clicked, the bird comes out. */
function clock(g: Ctx, s: SceneInput) {
	const hour = (((s.hours % 12) + s.minutes / 60) / 12) * Math.PI * 2;
	const minute = (s.minutes / 60) * Math.PI * 2;
	for (let i = 0; i < 6; i++) rect(g, 100 + i, 32 - i, 12 - i * 2, 1, C.wood);
	rect(g, 104, 28, 4, 4, C.ink);
	if (s.cuckoo && (s.still || Math.floor(s.t * 2) % 2 === 0)) {
		rect(g, 103, 24, 5, 4, C.amber);
		dot(g, 102, 25, C.bookC);
		dot(g, 104, 25, C.ink);
	}
	rect(g, 105, 47, 1, 6, C.trim);
	rect(g, 104, 53, 3, 2, C.amber);
	disc(g, 106, 40, 7, C.paper);
	ring(g, 106, 40, 7, C.trim);
	line(
		g,
		106,
		40,
		106 + Math.sin(hour) * 3.5,
		40 - Math.cos(hour) * 3.5,
		C.ink,
	);
	line(
		g,
		106,
		40,
		106 + Math.sin(minute) * 5.5,
		40 - Math.cos(minute) * 5.5,
		C.frame,
	);
}

/** A climb with a flag on it: the wall's one picture until medals hang there. */
function poster(g: Ctx) {
	rect(g, 272, 36, 30, 34, C.trim);
	rect(g, 274, 38, 26, 30, C.shelf);
	for (let x = 0; x < 26; x++) {
		const h = Math.round(Math.max(0, 16 - Math.abs(x - 14) * 1.3));
		rect(g, 274 + x, 64 - h, 1, h + 4, C.book);
	}
	rect(g, 287, 46, 1, 6, C.lilac);
	rect(g, 288, 46, 4, 3, C.amber);
}

function plant(g: Ctx, s: SceneInput) {
	if (s.season === 'winter') return tree(g, s);
	const sway = s.still ? 0 : Math.round(Math.sin(s.t * 1.1));
	const leaves: [number, number][] = [
		[-0.4, 13],
		[0.1, 16],
		[0.7, 14],
		[1.3, 15],
		[1.9, 12],
		[2.5, 13],
	];
	leaves.forEach(([angle, length], i) =>
		line(
			g,
			12,
			148,
			12 + Math.cos(angle + Math.PI * 0.18) * length * 0.7 + sway,
			148 - Math.abs(Math.sin(angle + 0.6)) * length,
			i % 2 ? C.leaf : C.leafLight,
		),
	);
	rect(g, 6, 148, 12, 12, C.woodLight);
	rect(g, 5, 148, 14, 2, C.wood);
}

/** December: a small tree where the plant stands, its lights slow and soft. */
function tree(g: Ctx, s: SceneInput) {
	for (let i = 0; i < 18; i++) {
		const w = 3 + Math.floor((i % 6) * 1.6) + Math.floor(i / 6) * 2;
		rect(
			g,
			12 - Math.floor(w / 2),
			130 + i,
			w,
			1,
			i % 2 ? C.leaf : C.leafLight,
		);
	}
	rect(g, 11, 127, 3, 3, C.amber);
	const hues = [C.heart, C.bulb, C.tealLight];
	for (let i = 0; i < 7; i++) {
		const on = s.still || Math.floor(s.t + i * 0.7) % 3 !== 0;
		if (on)
			dot(g, 7 + Math.floor(hash3(i, 4, 4) * 11), 133 + i * 2, hues[i % 3]);
	}
	rect(g, 6, 148, 12, 12, C.woodLight);
	rect(g, 5, 148, 14, 2, C.wood);
}

function desk(g: Ctx, s: SceneInput) {
	rect(g, 18, 118, 100, 3, C.woodLight);
	rect(g, 18, 121, 100, 2, C.wood);
	rect(g, 20, 123, 3, 32, C.wood);
	rect(g, 113, 123, 3, 32, C.wood);
	// The laptop's code scrolls a line every half second.
	rect(g, 40, 98, 30, 18, C.laptop);
	rect(g, 42, 100, 26, 14, C.screen);
	const scroll = s.still ? 0 : Math.floor(s.t * 2);
	for (let i = 0; i < 6; i++) {
		const n = i + scroll;
		const indent = Math.floor(hash3(n, 1, 2) * 3) * 2;
		const length = 6 + Math.floor(hash3(n, 3, 4) * 16);
		const hue = [C.violet, C.teal, C.lilac][Math.floor(hash3(n, 5, 6) * 3)];
		rect(g, 43 + indent, 101 + i * 2, Math.min(length, 24 - indent), 1, hue);
	}
	rect(g, 38, 116, 34, 2, C.rug);
	// The mug and its steam, or on the floor where the cat put it.
	if (s.mugDown) {
		rect(g, 140, 156, 7, 4, C.lilac);
		rect(g, 147, 157, 1, 2, C.lilac);
		rect(g, 141, 160, 9, 1, C.tealLight);
	} else {
		rect(g, 82, 111, 6, 7, C.lilac);
		rect(g, 88, 113, 2, 1, C.lilac);
		rect(g, 89, 113, 1, 3, C.lilac);
		rect(g, 88, 115, 2, 1, C.lilac);
		g.globalAlpha = 0.6;
		for (let i = 0; i < 3; i++)
			dot(
				g,
				84 + (s.still ? 0 : Math.round(Math.sin(s.t * 2 + i * 1.7))),
				108 - i * 2,
				C.lilac,
			);
		g.globalAlpha = 1;
	}
	// The lamp.
	rect(g, 100, 115, 10, 3, C.trim);
	rect(g, 104, 100, 2, 15, C.trim);
	rect(g, 98, 96, 12, 5, C.woodLight);
	if (!s.lampOn) return;
	rect(g, 100, 101, 8, 1, C.amber);
	g.globalAlpha = 0.13;
	g.fillStyle = C.amber;
	g.beginPath();
	g.moveTo(99, 101);
	g.lineTo(109, 101);
	g.lineTo(126, 118);
	g.lineTo(82, 118);
	g.closePath();
	g.fill();
	g.globalAlpha = 1;
}

/** The record player is the deck: it turns while something plays. */
function deck(g: Ctx, s: SceneInput) {
	rect(g, 262, 118, 52, 3, C.woodLight);
	rect(g, 266, 121, 2, 5, C.wood);
	rect(g, 308, 121, 2, 5, C.wood);
	rect(g, 266, 110, 40, 8, C.trim);
	rect(g, 266, 109, 40, 1, C.sillTop);
	rect(g, 276, 106, 12, 1, C.ink);
	rect(g, 273, 107, 18, 2, C.ink);
	rect(g, 276, 109, 12, 1, C.ink);
	rect(g, 282, 107, 2, 1, C.amber);
	if (s.playing && !s.still) {
		// A scratch runs the platter back, fast.
		const a = s.scratch ? -s.t * 14 : s.t * 3.5;
		dot(
			g,
			282 + Math.round(Math.cos(a) * 7),
			107 + Math.round(Math.sin(a)),
			C.cable,
		);
	}
	rect(g, 298, 103, 1, 6, C.lilac);
	rect(g, 292, 103, 6, 1, C.lilac);
	dot(g, 302, 113, s.playing ? C.teal : C.wood);
	// The speaker's cone moves on the kick.
	rect(g, 290, 134, 20, 26, C.door);
	rect(g, 290, 134, 20, 1, C.trim);
	const pump =
		s.playing && s.pulsing && !s.still ? Math.round(pulseOf(s) * 1.4) : 0;
	disc(g, 300, 150, 5 + pump, C.ink);
	ring(g, 300, 150, 5 + pump, C.woodLight);
	disc(g, 300, 139, 2, C.ink);
}

/** How dark the room is with the lamp on or off under a sky. */
export function shadeFor(lampOn: boolean, sky: Sky): number {
	if (lampOn) return sky === 'night' ? 0.12 : 0;
	return sky === 'night' ? 0.42 : sky === 'dusk' ? 0.25 : 0.1;
}

/** With the lamp off, the room darkens and the window stays as bright. */
export function drawShade(g: Ctx, s: SceneInput, ox: number, oy: number) {
	const dim = s.shade;
	if (dim < 0.005) return;
	g.globalAlpha = dim;
	g.fillStyle = C.shade;
	g.beginPath();
	g.rect(0, 0, s.w, s.h);
	g.rect(ox + 122, oy + 22, 136, 86);
	g.fill('evenodd');
	g.globalAlpha = 1;
}
