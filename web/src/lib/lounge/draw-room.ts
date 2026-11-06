/**
 * The room itself, seen from above at an angle: the back wall with its
 * curtains, sign, clock and poster, the desk and lamp, the cabinet the
 * record player and speaker stand on, the sofa under the window, the rug and
 * the table, the stove between the sofa and the cabinet. All of it but what moves is drawn once onto a canvas of its own
 * (drawBack); drawLive adds what moves over it, and drawShade the dark that
 * falls when the lamp is off.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import {
	disc,
	dot,
	ellipse,
	line,
	outlined,
	pool,
	rect,
	ring,
	text,
	textWidth,
	type Ctx,
} from '$lib/lounge/pixel';
import type { Sky } from '$lib/lounge/palette';
import {
	FLOOR_Y,
	FRONT_Y,
	hasFront,
	pulseOf,
	type SceneInput,
} from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';
import { paintSides } from '$lib/lounge/draw-sides';
import { WINDOW } from '$lib/lounge/draw-window';
import { bakeLight, type Light } from '$lib/lounge/light';
import { drawFondue, momentDressing } from '$lib/lounge/draw-moments';
import {
	FRONT_LAMPS,
	foreground,
	frontRow,
	mats,
} from '$lib/lounge/draw-floor';

/** The sign's five bars trace the equalizer W (ADR-0005). */
const SIGN_BARS = [20, 9, 14, 9, 20];

let back: { key: string; canvas: HTMLCanvasElement } | undefined;

/** The theme changed: the room is drawn again in its colours. */
export function forgetWalls() {
	back = undefined;
}

/**
 * Everything that holds still: drawn again only when the room's size, the
 * lamp or the season changes, so a frame is one image and what moves.
 */
export function drawBack(g: Ctx, s: SceneInput, ox: number, oy: number) {
	const key = `${s.w}x${s.h}:${s.lampOn}:${s.season}:${s.sky}:${s.fire}:${s.moment}`;
	if (back?.key !== key) {
		const canvas = document.createElement('canvas');
		canvas.width = s.w;
		canvas.height = s.h;
		const b = canvas.getContext('2d')!;
		walls(b, s.w, s.h, oy);
		if (oy >= 24) upperWall(b, s.w, ox, oy, s.moment === 'tour');
		const lamps = paintSides(b, s, ox, oy);
		b.translate(ox, oy);
		curtains(b);
		windowFrame(b);
		signFrame(b);
		chalkboard(b);
		corkboard(b);
		wallShelf(b);
		desk(b, s.lampOn);
		cabinet(b);
		if (s.season === 'winter') tree(b);
		else plant(b);
		sofa(b);
		stove(b);
		mats(b);
		rug(b);
		table(b);
		if (hasFront(s.w, s.h)) frontRow(b);
		momentDressing(b, s.moment);
		b.setTransform(1, 0, 0, 1, 0, 0);
		foreground(b, s.w, s.h, oy);
		bakeLight(
			b,
			lightsOf(s, ox, oy, lamps),
			s.sky,
			{ w: s.w, h: s.h, floorRow: oy + FLOOR_Y },
			{ warm: C.glow, cool: C.moon, shade: C.shade },
		);
		back = { key, canvas };
	}
	g.drawImage(back.canvas, 0, 0);
}

/** What lights the room right now, in room pixels. */
function lightsOf(s: SceneInput, ox: number, oy: number, lamps: number[]) {
	const at = (l: Light): Light => ({ ...l, x: l.x + ox, y: l.y + oy });
	const lights: Light[] = [
		// The bulbs across the ceiling, and the lantern on the table.
		{ x: s.w / 2, y: 0, rx: s.w * 0.8, ry: 26, power: 0.3, on: 'wall' },
		at({ x: 160, y: 120, rx: 88, ry: 34, power: 0.5, on: 'floor' }),
	];
	if (s.lampOn) {
		lights.push(
			at({ x: 88, y: 40, rx: 62, ry: 46, power: 1, on: 'wall' }),
			at({ x: 84, y: 92, rx: 80, ry: 20, power: 0.7, on: 'floor' }),
		);
		const floor = oy + FLOOR_Y;
		for (const x of lamps)
			lights.push(
				{ x, y: floor - 44, rx: 42, ry: 50, power: 0.8, on: 'wall' },
				{ x, y: floor + 10, rx: 52, ry: 16, power: 0.6, on: 'floor' },
			);
	}
	if (s.fire)
		lights.push(
			at({ x: 226, y: 94, rx: 70, ry: 20, power: 0.9, on: 'floor' }),
			at({ x: 226, y: 68, rx: 36, ry: 30, power: 0.5, on: 'wall' }),
		);
	lights.push(
		at(
			s.sky === 'night'
				? { x: 160, y: 98, rx: 84, ry: 24, power: 0.4, cool: true, on: 'floor' }
				: { x: 160, y: 104, rx: 96, ry: 30, power: 0.6, on: 'floor' },
		),
	);
	if (hasFront(s.w, s.h)) {
		lights.push(
			at({ x: 233, y: FRONT_Y - 18, rx: 40, ry: 30, power: 0.4, cool: true }),
		);
		if (s.lampOn)
			for (const { x, up, rx, power } of FRONT_LAMPS)
				lights.push(at({ x, y: FRONT_Y - up, rx, ry: 24, power, on: 'floor' }));
	}
	return lights;
}

function walls(g: Ctx, w: number, h: number, oy: number) {
	const floor = oy + FLOOR_Y;
	rect(g, 0, 0, w, floor, C.wall);
	rect(g, 0, 0, w, 2, C.wallDark);
	// Wallpaper: a small diamond on a staggered grid, one step off the wall.
	for (let y = 12, row = 0; y < floor - 22; y += 12, row++)
		for (let x = (row % 2) * 8 + 4; x < w; x += 16) {
			dot(g, x, y - 1, C.wallLight);
			rect(g, x - 1, y, 3, 1, C.wallLight);
			dot(g, x, y + 1, C.wallLight);
		}
	// The rail, the wainscot's panels and the skirting board.
	rect(g, 0, floor - 18, w, 1, C.trim);
	rect(g, 0, floor - 17, w, 14, C.wallDark);
	for (let x = 4; x < w; x += 24) {
		rect(g, x, floor - 14, 18, 1, C.trim);
		rect(g, x, floor - 13, 1, 8, C.trim);
	}
	rect(g, 0, floor - 3, w, 2, C.wood);
	rect(g, 0, floor - 3, w, 1, C.woodLight);
	rect(g, 0, floor - 1, w, 1, C.woodDark);
	// Long boards running across, each a shade of its own, their ends staggered
	// and a run of grain in some, so the floor reads as wood and never as brick.
	rect(g, 0, floor, w, h - floor, C.floor);
	rect(g, 0, floor, w, 1, C.floorDark);
	for (let y = floor + 1, k = 0; y < h; y += 8, k++) {
		for (let x = -Math.floor(hash3(k, 1, 7) * 90), n = 0; x < w; n++) {
			const long = 70 + Math.floor(hash3(k, n, 8) * 70);
			if (hash3(k, n, 9) > 0.55) rect(g, x, y, long, 7, C.floorLight);
			rect(g, x + long - 1, y + 2, 1, 5, C.floorDark);
			if (hash3(k, n, 3) > 0.5)
				rect(
					g,
					x + 8 + Math.floor(hash3(k, n, 4) * (long - 24)),
					y + 3,
					9,
					1,
					C.floorDark,
				);
			x += long;
		}
		rect(g, 0, y + 7, w, 1, C.floorDark);
	}
}

/** A tall room's wall above the stage: a string of pennants and two framed jerseys. */
function upperWall(g: Ctx, w: number, ox: number, oy: number, tour: boolean) {
	const y0 = Math.round(oy * 0.45) + 8;
	const hues = [C.teal, C.heart, C.amber, C.lilac];
	for (let x = 0; x < w; x++)
		rect(g, x, y0 + Math.round(Math.sin((x / w) * Math.PI) * 3), 1, 1, C.cable);
	for (let x = 4, k = 0; x < w - 4; x += 10, k++) {
		const y = y0 + Math.round(Math.sin((x / w) * Math.PI) * 3) + 1;
		for (let r = 0; r < 5; r++)
			rect(
				g,
				x + Math.floor(r / 2),
				y + r,
				5 - Math.floor(r / 2) * 2,
				1,
				hues[k % 4],
			);
	}
	if (oy < 34) return;
	for (const [x, n] of [
		[ox + 34, 0],
		[ox + 270, 1],
	]) {
		outlined(g, [[x, y0 + 8, 18, 18, C.trim]], C.ink);
		rect(g, x + 2, y0 + 10, 14, 14, C.poster);
		const shirt = n ? C.teal : tour ? C.amber : C.heart;
		rect(g, x + 4, y0 + 12, 10, 3, shirt);
		rect(g, x + 6, y0 + 15, 6, 7, shirt);
		rect(g, x + 8, y0 + 12, 2, 1, C.poster);
		rect(g, x + 6, y0 + 18, 6, 1, C.paper);
	}
}

/** Curtains either side of the window, tied back, on a rod. */
function curtains(g: Ctx) {
	rect(g, 100, 4, 120, 2, C.woodDark);
	rect(g, 99, 3, 3, 4, C.woodLight);
	rect(g, 218, 3, 3, 4, C.woodLight);
	for (const x0 of [104, 204]) {
		outlined(g, [[x0, 6, 12, 56, C.curtain]], C.ink);
		for (let x = x0 + 1; x < x0 + 12; x += 3)
			rect(g, x, 6, 1, 56, C.curtainDark);
		rect(g, x0, 40, 12, 2, C.amberDark);
	}
}

function windowFrame(g: Ctx) {
	const { X, Y, W, H } = WINDOW;
	rect(g, X - 2, Y - 2, W + 4, 2, C.frame);
	rect(g, X - 2, Y, 2, H, C.frame);
	rect(g, X + W, Y, 2, H, C.frame);
	rect(g, X - 2, Y + H, W + 4, 2, C.frame);
	outlined(g, [[X - 6, Y + H + 2, W + 12, 4, C.wood]], C.ink);
	rect(g, X - 6, Y + H + 2, W + 12, 2, C.woodTop);
}

function signFrame(g: Ctx) {
	outlined(g, [[22, 14, 38, 30, C.poster]], C.ink);
	rect(g, 22, 14, 38, 1, C.frame);
	rect(g, 22, 43, 38, 1, C.frame);
	rect(g, 22, 14, 1, 30, C.frame);
	rect(g, 59, 14, 1, 30, C.frame);
}

/** The crew's next ride, in chalk (drawLive writes it). */
function chalkboard(g: Ctx) {
	outlined(g, [[64, 12, 38, 22, C.wood]], C.ink);
	rect(g, 64, 12, 38, 1, C.woodTop);
	rect(g, 66, 14, 34, 17, C.slate);
	rect(g, 66, 31, 34, 1, C.woodDark);
	rect(g, 92, 32, 5, 1, C.paper);
}

/** The crew's pins as notes (drawLive), and room below them for what comes. */
function corkboard(g: Ctx) {
	outlined(g, [[244, 12, 26, 26, C.woodDark]], C.ink);
	rect(g, 245, 13, 24, 24, C.cork);
	for (let i = 0; i < 16; i++)
		dot(
			g,
			245 + Math.floor(hash3(i, 2, 7) * 24),
			13 + Math.floor(hash3(i, 3, 7) * 24),
			C.corkDark,
		);
}

/** A shelf over the speaker: records, a book and a small plant. */
function wallShelf(g: Ctx) {
	outlined(g, [[274, 28, 32, 2, C.woodLight]], C.ink);
	const sleeves = [C.bookC, C.teal, C.amber, C.violet];
	sleeves.forEach((c, i) => rect(g, 276 + i * 3, 18, 3, 10, c));
	rect(g, 290, 21, 2, 7, C.bookB);
	rect(g, 297, 23, 6, 5, C.woodLight);
	line(g, 300, 23, 298, 17, C.leafLight);
	line(g, 300, 23, 303, 18, C.leaf);
}

function desk(g: Ctx, lampOn: boolean) {
	// Top, front edge and legs, with their shadow on the floor.
	rect(g, 28, 84, 72, 1, C.floorDark);
	outlined(
		g,
		[
			[28, 67, 3, 17, C.woodDark],
			[96, 67, 3, 17, C.woodDark],
			[26, 60, 75, 7, C.wood],
		],
		C.ink,
	);
	rect(g, 26, 60, 75, 1, C.woodTop);
	rect(g, 26, 61, 75, 3, C.woodLight);
	// The laptop, open toward the room.
	outlined(
		g,
		[
			[46, 45, 23, 13, C.laptop],
			[44, 58, 27, 3, C.laptopLight],
		],
		C.ink,
	);
	rect(g, 48, 47, 19, 9, C.screen);
	// The lamp's base, stem, arm and shade.
	outlined(g, [[86, 58, 11, 2, C.trim]], C.ink);
	rect(g, 91, 46, 1, 12, C.trim);
	line(g, 91, 46, 88, 41, C.trim);
	outlined(g, [[82, 36, 13, 5, C.woodLight]], C.ink);
	rect(g, 82, 36, 13, 1, C.woodTop);
	if (lampOn) rect(g, 84, 41, 9, 1, C.amber);
}

/** The low cabinet the record player and its speaker stand on. */
function cabinet(g: Ctx) {
	rect(g, 236, 85, 71, 1, C.floorDark);
	outlined(g, [[236, 60, 71, 23, C.wood]], C.ink);
	rect(g, 236, 60, 71, 1, C.woodTop);
	rect(g, 236, 61, 71, 4, C.woodLight);
	for (const x of [240, 272]) {
		rect(g, x, 67, 30, 1, C.woodDark);
		rect(g, x, 67, 1, 13, C.woodDark);
		rect(g, x + 29, 67, 1, 13, C.woodDark);
		rect(g, x, 79, 30, 1, C.woodDark);
	}
	dot(g, 266, 73, C.amber);
	dot(g, 276, 73, C.amber);
	rect(g, 238, 83, 3, 2, C.ink);
	rect(g, 302, 83, 3, 2, C.ink);
	// The record player's box and platter.
	outlined(g, [[240, 54, 28, 6, C.trim]], C.ink);
	rect(g, 240, 54, 28, 1, C.woodTop);
	ellipse(g, 252, 56, 8, 1, C.ink);
	line(g, 264, 54, 259, 57, C.lilac);
	// The speaker: its box; the cones move with the music (drawLive).
	outlined(g, [[284, 40, 19, 20, C.speaker]], C.ink);
	rect(g, 284, 40, 19, 1, C.trim);
}

function plant(g: Ctx) {
	rect(g, 11, 84, 14, 1, C.floorDark);
	const leaves: [number, number][] = [
		[-0.5, 26],
		[-0.15, 32],
		[0.2, 30],
		[0.5, 34],
		[0.9, 28],
		[1.3, 24],
	];
	leaves.forEach(([angle, length], i) => {
		const tx = 18 + Math.sin(angle - 0.4) * length * 0.6;
		const ty = 72 - Math.cos(angle - 0.4) * length;
		line(g, 18, 72, tx, ty, i % 2 ? C.leaf : C.leafLight);
		line(g, 19, 72, tx + 1, ty, C.leafDark);
		ellipse(
			g,
			Math.round(tx),
			Math.round(ty),
			2,
			1,
			i % 2 ? C.leaf : C.leafLight,
		);
	});
	outlined(g, [[12, 72, 12, 12, C.woodLight]], C.ink);
	rect(g, 11, 72, 14, 2, C.wood);
	rect(g, 21, 74, 3, 10, C.wood);
}

/** December: a small tree where the plant stands; its lights twinkle in drawLive. */
function tree(g: Ctx) {
	rect(g, 9, 84, 18, 1, C.floorDark);
	for (let i = 0; i < 30; i++) {
		const w = 3 + Math.floor((i % 10) * 1.2) + Math.floor(i / 10) * 3;
		rect(g, 18 - Math.floor(w / 2), 48 + i, w, 1, i % 2 ? C.leaf : C.leafLight);
	}
	rect(g, 17, 45, 3, 3, C.amber);
	outlined(g, [[14, 78, 9, 6, C.woodLight]], C.ink);
}

/** The sofa under the window, facing the room: back, arms, four seats. */
function sofa(g: Ctx) {
	ellipse(g, 160, 88, 56, 2, C.floorDark);
	outlined(
		g,
		[
			[112, 60, 97, 12, C.sofa],
			[114, 72, 93, 12, C.sofa],
			[106, 64, 8, 22, C.sofa],
			[207, 64, 8, 22, C.sofa],
		],
		C.ink,
	);
	// Light on its top edges, shadow under the seat.
	rect(g, 112, 60, 97, 2, C.sofaLight);
	for (let x = 120; x < 206; x += 11) dot(g, x, 66, C.sofaDark);
	rect(g, 114, 72, 93, 1, C.sofaTop);
	rect(g, 114, 73, 93, 3, C.sofaLight);
	for (const x of [136, 159, 182]) rect(g, x, 72, 1, 12, C.sofaDark);
	rect(g, 114, 82, 93, 2, C.sofaDark);
	for (const x of [106, 207]) {
		rect(g, x, 64, 8, 2, C.sofaTop);
		rect(g, x, 84, 8, 2, C.sofaDark);
		rect(g, x + 1, 86, 2, 2, C.ink);
	}
}

/**
 * A small cast-iron stove in the corner between the sofa and the cabinet,
 * its pipe into the wall under the clock. Its fire is drawLive's.
 */
function stove(g: Ctx) {
	rect(g, 217, 86, 17, 1, C.floorDark);
	outlined(
		g,
		[
			[224, 52, 3, 11, C.laptop],
			[222, 50, 7, 2, C.laptopLight],
			[219, 66, 13, 18, C.laptop],
			[218, 63, 15, 3, C.laptopLight],
		],
		C.ink,
	);
	rect(g, 224, 52, 1, 11, C.laptopLight);
	rect(g, 218, 63, 15, 1, C.cable);
	rect(g, 219, 66, 1, 18, C.laptopLight);
	// The door: a frame round its glass, the ash drawer under it, two feet.
	rect(g, 220, 68, 11, 10, C.laptopLight);
	rect(g, 221, 69, 9, 8, C.ink);
	rect(g, 221, 80, 9, 2, C.laptopLight);
	dot(g, 225, 81, C.cable);
	rect(g, 219, 84, 2, 2, C.ink);
	rect(g, 230, 84, 2, 2, C.ink);
}

/** The round rug the crew sits around. */
function rug(g: Ctx) {
	ellipse(g, 160, 123, 67, 23, C.ink);
	ellipse(g, 160, 122, 66, 22, C.rugDark);
	ellipse(g, 160, 122, 63, 20, C.rug);
	ellipse(g, 160, 122, 55, 16, C.rugLine);
	ellipse(g, 160, 122, 54, 15, C.rug);
	for (let k = -4; k <= 4; k++) {
		const x = 160 + k * 12;
		const y = 122 + (k % 2 ? 9 : -9);
		dot(g, x, y - 1, C.rugLine);
		rect(g, x - 1, y, 3, 1, C.rugLine);
		dot(g, x, y + 1, C.rugLine);
	}
}

/** The low table on the rug, two mugs and a bowl on it. */
function table(g: Ctx) {
	ellipse(g, 160, 126, 24, 2, C.rugDark);
	outlined(
		g,
		[
			[140, 120, 2, 6, C.woodDark],
			[178, 120, 2, 6, C.woodDark],
			[138, 110, 45, 10, C.wood],
		],
		C.ink,
	);
	rect(g, 138, 110, 45, 1, C.woodTop);
	rect(g, 138, 111, 45, 6, C.woodLight);
	outlined(
		g,
		[
			[146, 106, 4, 5, C.teal],
			[171, 106, 4, 5, C.heart],
		],
		C.ink,
	);
	ellipse(g, 160, 109, 5, 1, C.ink);
	rect(g, 156, 108, 9, 1, C.amber);
	dot(g, 158, 107, C.amberDark);
	dot(g, 162, 107, C.amberDark);
	// The lantern: its flame is drawLive's.
	outlined(g, [[177, 104, 4, 6, C.woodDark]], C.ink);
	rect(g, 178, 105, 2, 4, C.amberDark);
	rect(g, 177, 103, 4, 1, C.woodTop);
}

/** What moves on the wall and the furniture, over drawBack's picture. */
export function drawLive(g: Ctx, s: SceneInput) {
	signBars(g, s);
	chalk(g, s);
	notes(g, s);
	clock(g, s);
	laptop(g, s);
	mug(g, s);
	deck(g, s);
	fishBowl(g, s);
	fire(g, s);
	lantern(g, s);
	if (s.season === 'winter') treeLights(g, s);
	if (s.bloom) bloom(g);
	if (s.fondue) drawFondue(g, s);
	else if (s.pizza) pizza(g);
	if (s.owl && s.season !== 'halloween') owl(g, s);
	if (hasFront(s.w, s.h)) arcade(g, s);
}

/** The table's lantern: a flame two pixels wide that never quite holds still. */
function lantern(g: Ctx, s: SceneInput) {
	const lean = s.still ? 0 : Math.floor(hash3(Math.floor(s.t * 4), 2, 5) * 2);
	rect(g, 178, 105, 2, 4, C.amber);
	rect(g, 178 + lean, 106, 1, 2, C.bulb);
}

/** The goldfish on the cabinet swims to and fro; tapped, it jumps. */
function fishBowl(g: Ctx, s: SceneInput) {
	ellipse(g, 275, 55, 6, 5, C.ink);
	ellipse(g, 275, 55, 5, 4, C.bookB);
	rect(g, 271, 51, 9, 1, C.tealLight);
	rect(g, 272, 53, 1, 2, C.paper);
	const swim = s.still ? 0 : Math.round(Math.sin(s.t * 1.3) * 2);
	const hop =
		s.fishJump && !s.still ? Math.round(Math.sin(s.t * 9) * 3) - 4 : 0;
	const left = !s.still && Math.cos(s.t * 1.3) < 0;
	rect(g, 274 + swim, 56 + hop, 3, 2, C.amber);
	rect(g, left ? 277 + swim : 273 + swim, 56 + hop, 1, 2, C.amberDark);
	if (!s.still && Math.floor(s.t * 2) % 3 === 0)
		rect(g, 276 + swim, 52, 1, 1, C.paper);
}

/** How tall the flames stand in each of the glass's nine columns: highest in the middle. */
const FLAME = [1, 3, 4, 5, 6, 5, 4, 3, 1];

/**
 * The stove's glass: cold, a glint; lit, flames over two logs, white-hot
 * at the root and red at the tips, every column its own height on every
 * sixth of a second, and their light on the floor.
 */
function fire(g: Ctx, s: SceneInput) {
	if (!s.fire) {
		dot(g, 222, 70, C.cable);
		return;
	}
	const k = s.still ? 0 : Math.floor(s.t * 6);
	pool(g, 226, 91, 26 + Math.floor(hash3(k, 7, 3) * 5), 6, C.litFloor, 0.7);
	FLAME.forEach((tall, c) => {
		const h = Math.max(
			1,
			Math.min(7, tall + Math.floor(hash3(k, c, 31) * 3) - 1),
		);
		for (let r = 0; r < h; r++)
			dot(
				g,
				221 + c,
				75 - r,
				r < h * 0.4 ? C.bulb : r < h * 0.75 ? C.amber : C.amberDark,
			);
	});
	rect(g, 221, 76, 4, 1, C.woodLight);
	rect(g, 226, 76, 4, 1, C.woodLight);
	dot(g, 225, 76, C.amberDark);
}

/** Touched, the plant flowers for a while. */
function bloom(g: Ctx) {
	for (const [x, y] of [
		[13, 46],
		[22, 40],
		[27, 52],
	]) {
		rect(g, x - 1, y, 3, 1, C.heart);
		rect(g, x, y - 1, 1, 3, C.heart);
		rect(g, x, y, 1, 1, C.amber);
	}
}

/** Friday from five, the bowl on the table is a pizza. */
function pizza(g: Ctx) {
	ellipse(g, 160, 112, 9, 3, C.ink);
	ellipse(g, 160, 112, 8, 2, C.amberDark);
	ellipse(g, 160, 112, 6, 1, C.amber);
	for (const x of [156, 160, 164])
		rect(g, x, 112 - (x % 3 ? 1 : 0), 1, 1, C.heart);
}

/** Past midnight an owl keeps the sill, blinking now and then. */
function owl(g: Ctx, s: SceneInput) {
	const x = 124;
	const y = WINDOW.Y + WINDOW.H + 2;
	outlined(
		g,
		[
			[x, y - 8, 7, 8, C.wood],
			[x, y - 9, 1, 1, C.wood],
			[x + 6, y - 9, 1, 1, C.wood],
		],
		C.ink,
	);
	rect(g, x + 1, y - 3, 5, 3, C.woodLight);
	const shut = !s.still && s.t % 5 < 0.2;
	rect(g, x + 1, y - 6, 2, shut ? 1 : 2, C.amber);
	rect(g, x + 4, y - 6, 2, shut ? 1 : 2, C.amber);
	dot(g, x + 3, y - 4, C.amberDark);
}

/** The arcade's attract loop, a little road and a rider; tapped, the rider races. */
function arcade(g: Ctx, s: SceneInput) {
	const x0 = 226;
	const y0 = FRONT_Y - 33;
	const speed = s.arcade ? 24 : 6;
	const run = s.still ? 0 : s.t * speed;
	rect(g, x0, y0 + 8, 15, 1, C.grid);
	for (let i = 0; i < 4; i++)
		rect(g, x0 + ((Math.floor(run) + i * 4) % 15), y0 + 9, 2, 1, C.lilac);
	const rx = x0 + (s.arcade ? Math.floor(run / 3) % 13 : 6);
	rect(g, rx, y0 + 5, 2, 2, C.teal);
	rect(g, rx, y0 + 3, 2, 2, C.heart);
	if (s.arcade) text(g, '1', x0 + 1, y0 + 1, C.amber);
}

function signBars(g: Ctx, s: SceneInput) {
	SIGN_BARS.forEach((tall, i) => {
		const level = pulseOf({ ...s, beat: s.beat + i * 0.13, t: s.t + i });
		const h = Math.max(3, Math.round(tall * (0.55 + 0.45 * level)));
		rect(g, 25 + i * 7, 40 - h, 4, h, C.teal);
		rect(g, 25 + i * 7, 40 - h, 4, 1, C.tealLight);
	});
}

/** The next ride in chalk, or the board asking for one. */
function chalk(g: Ctx, s: SceneInput) {
	const { plan } = s.club;
	const lines = plan ? [plan.day, plan.time] : ['NEXT', 'RIDE?'];
	lines.forEach((line, i) =>
		text(
			g,
			line,
			83 - Math.floor(textWidth(line) / 2),
			16 + i * 7,
			i ? C.paper : C.amber,
		),
	);
}

/** One note a pin, up to six: a colour each and a pin through it. */
function notes(g: Ctx, s: SceneInput) {
	const hues = [C.paper, C.amber, C.tealLight, C.heart, C.bulb, C.lilac];
	for (let i = 0; i < Math.min(6, s.club.pins); i++) {
		const x = 247 + (i % 3) * 7 + Math.floor(hash3(i, 1, 3) * 2);
		const y = 15 + Math.floor(i / 3) * 7 + Math.floor(hash3(i, 2, 3) * 2);
		rect(g, x, y, 5, 5, hues[i]);
		rect(g, x + 1, y + 2, 3, 1, C.cable);
		dot(g, x + 2, y, C.red);
	}
	if (s.moment === 'tour') {
		// July: the leader's jersey, pinned below the notes.
		rect(g, 250, 29, 12, 3, C.amber);
		rect(g, 253, 32, 6, 4, C.amber);
		dot(g, 256, 29, C.red);
	}
}

/** A cuckoo clock: on the hour, or when clicked, the bird comes out. */
function clock(g: Ctx, s: SceneInput) {
	for (let i = 0; i < 6; i++)
		rect(g, 221 + i, 17 - i, 12 - i * 2, 1, C.woodLight);
	outlined(g, [[219, 18, 15, 20, C.wood]], C.ink);
	rect(g, 224, 19, 5, 3, C.ink);
	if (s.cuckoo && (s.still || Math.floor(s.t * 2) % 2 === 0)) {
		rect(g, 224, 14, 5, 4, C.amber);
		dot(g, 223, 15, C.bookC);
		dot(g, 225, 15, C.ink);
	}
	const hour = (((s.hours % 12) + s.minutes / 60) / 12) * Math.PI * 2;
	const minute = (s.minutes / 60) * Math.PI * 2;
	disc(g, 226, 29, 5, C.paper);
	ring(g, 226, 29, 5, C.trim);
	line(
		g,
		226,
		29,
		226 + Math.sin(hour) * 2.5,
		29 - Math.cos(hour) * 2.5,
		C.ink,
	);
	line(
		g,
		226,
		29,
		226 + Math.sin(minute) * 4,
		29 - Math.cos(minute) * 4,
		C.frame,
	);
	const swing = s.still ? 0 : Math.round(Math.sin(s.t * Math.PI) * 2);
	line(g, 226, 38, 226 + swing, 45, C.trim);
	rect(g, 225 + swing, 45, 3, 2, C.amber);
}

/**
 * The laptop's code scrolls a line every half second. While the crew has a
 * session running it shows that instead: LIVE, and a bar for each rider.
 */
function laptop(g: Ctx, s: SceneInput) {
	if (s.club.live > 0) {
		if (s.still || Math.floor(s.t * 2) % 2 === 0)
			text(g, 'LIVE', 50, 48, C.redLight);
		for (let i = 0; i < Math.min(5, s.club.live); i++)
			rect(g, 50 + i * 3, 54, 2, 1, C.teal);
		return;
	}
	const scroll = s.still ? 0 : Math.floor(s.t * 2);
	for (let i = 0; i < 4; i++) {
		const n = i + scroll;
		const indent = Math.floor(hash3(n, 1, 2) * 3) * 2;
		const length = 4 + Math.floor(hash3(n, 3, 4) * 12);
		const hue = [C.violet, C.teal, C.lilac][Math.floor(hash3(n, 5, 6) * 3)];
		rect(g, 50 + indent, 48 + i * 2, Math.min(length, 16 - indent), 1, hue);
	}
}

/** The mug and its steam, or on the floor where the cat put it. */
function mug(g: Ctx, s: SceneInput) {
	if (s.mugDown) {
		outlined(g, [[30, 94, 7, 4, C.lilac]], C.ink);
		rect(g, 38, 96, 6, 1, C.tealLight);
		return;
	}
	outlined(
		g,
		[
			[76, 53, 6, 7, C.lilac],
			[82, 55, 2, 3, C.lilac],
		],
		C.ink,
	);
	rect(g, 76, 53, 6, 1, C.paper);
	for (let i = 0; i < 3; i++)
		dot(
			g,
			78 + (s.still ? 0 : Math.round(Math.sin(s.t * 2 + i * 1.7))),
			50 - i * 2,
			C.lilac,
		);
}

/** The record player is the deck: it turns while something plays, its label the style. */
function deck(g: Ctx, s: SceneInput) {
	const label = {
		'': C.amber,
		mix: C.amber,
		lofi: C.heart,
		chip: C.teal,
		ambient: C.lilac,
	};
	rect(g, 251, 56, 3, 1, label[s.radio]);
	if (s.playing && !s.still) {
		// A scratch runs the platter back, fast.
		const a = s.scratch ? -s.t * 14 : s.t * 3.5;
		dot(
			g,
			252 + Math.round(Math.cos(a) * 6),
			56 + Math.round(Math.sin(a)),
			C.cable,
		);
	}
	dot(g, 266, 58, s.playing ? C.teal : C.woodDark);
	// The speaker's cone moves on the kick.
	const pump =
		s.playing && s.pulsing && !s.still ? Math.round(pulseOf(s) * 1.4) : 0;
	disc(g, 293, 53, 4 + pump, C.ink);
	ring(g, 293, 53, 4 + pump, C.woodLight);
	disc(g, 293, 45, 2, C.ink);
}

function treeLights(g: Ctx, s: SceneInput) {
	const hues = [C.heart, C.bulb, C.tealLight];
	for (let i = 0; i < 8; i++) {
		const on = s.still || Math.floor(s.t + i * 0.7) % 3 !== 0;
		if (on)
			dot(g, 13 + Math.floor(hash3(i, 4, 4) * 11), 52 + i * 3, hues[i % 3]);
	}
}

/** How dark the room is with the lamp on or off under a sky; a lit stove lifts a third of it. */
export function shadeFor(lampOn: boolean, sky: Sky, fireLit = false): number {
	const dark = lampOn
		? sky === 'night'
			? 0.12
			: 0
		: sky === 'night'
			? 0.42
			: sky === 'dusk'
				? 0.25
				: 0.1;
	return fireLit ? dark * 0.65 : dark;
}

/**
 * With the lamp off, the room darkens and the window stays as bright. A lit
 * stove washes the room warm: an amber a few percent strong that breathes
 * by one percent, far under anything that could flash (WCAG 2.3.1).
 */
export function drawShade(g: Ctx, s: SceneInput, ox: number, oy: number) {
	const { X, Y, W, H } = WINDOW;
	const veil = (colour: string, alpha: number) => {
		g.globalAlpha = alpha;
		g.fillStyle = colour;
		g.beginPath();
		g.rect(0, 0, s.w, s.h);
		g.rect(ox + X, oy + Y, W, H);
		g.fill('evenodd');
		g.globalAlpha = 1;
	};
	if (s.shade >= 0.005) veil(C.shade, s.shade);
	if (s.fire) {
		const breath = s.still ? 0.5 : hash3(Math.floor(s.t * 5), 1, 9);
		veil(C.amberDark, 0.06 + breath * 0.01);
	}
}
