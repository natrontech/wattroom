/**
 * A tall room's floor, all of it still and drawn once with the room
 * (drawBack): the workshop, the reading nook, the arcade and the coffee bar
 * along the front row, things left lying where the crew dropped them between
 * the rug and that row, and dark leaves and a stool up close at the very
 * bottom. Everything is at the people's scale, and only the arcade is
 * clickable (hotspots in scene.ts).
 */
import { LOUNGE as C, shadeOf } from '$lib/lounge/palette';
import {
	disc,
	dot,
	ellipse,
	limb,
	line,
	outlined,
	rect,
	ring,
	type Ctx,
} from '$lib/lounge/pixel';
import { BIKE_GROUND, BIKE_XS, FLOOR_Y, FRONT_Y } from '$lib/lounge/scene';

/** The nook's lamp stands here. */
const NOOK_X = 124;
/** The front row's lamps, for the room's light: across, and how far up from the row. */
export const FRONT_LAMPS = [
	{ x: NOOK_X, up: 2, rx: 84, power: 1.1 },
	{ x: 281, up: 4, rx: 62, power: 0.9 },
	{ x: 50, up: 6, rx: 66, power: 0.8 },
];

/** Rows under the front row before the room bothers with a foreground. */
const FOREGROUND_ROWS = 22;

/**
 * A rubber mat under the two trainers that always stand there, and the
 * dynamo beside each with its cable to the wall: riding lights the bulbs
 * (drawLights).
 */
export function mats(g: Ctx) {
	for (const x of BIKE_XS) {
		const out = x < 160 ? -1 : 1;
		const box = x + out * 21;
		line(g, box, BIKE_GROUND - 8, box + out * 6, FLOOR_Y + 2, C.cable);
		rect(g, x - 25, BIKE_GROUND - 9, 50, 13, C.ink);
		rect(g, x - 24, BIKE_GROUND - 8, 48, 11, C.laptop);
		rect(g, x - 24, BIKE_GROUND - 8, 48, 1, C.laptopLight);
		outlined(g, [[box - 2, BIKE_GROUND - 11, 5, 5, C.amberDark]], C.ink);
		dot(g, box, BIKE_GROUND - 9, C.bulb);
	}
}

/** A wheel leaning on a crate of old parts, left of the middle of the floor. */
function spares(g: Ctx) {
	ellipse(g, 40, 201, 20, 2, C.floorDark);
	outlined(g, [[32, 184, 26, 16, C.wood]], C.ink);
	rect(g, 32, 184, 26, 1, C.woodTop);
	rect(g, 32, 191, 26, 1, C.woodDark);
	rect(g, 37, 180, 3, 4, C.cable);
	rect(g, 44, 178, 4, 6, C.amberDark);
	rect(g, 51, 181, 3, 3, C.trim);
	ring(g, 28, 190, 11, C.ink);
	ring(g, 28, 190, 10, C.lilac);
	ring(g, 28, 190, 9, C.ink);
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI;
		line(
			g,
			28 - Math.cos(a) * 8,
			190 - Math.sin(a) * 8,
			28 + Math.cos(a) * 8,
			190 + Math.sin(a) * 8,
			C.cable,
		);
	}
	disc(g, 28, 190, 1, C.ink);
}

/** A crate of bottles and a cactus on it, right of the middle of the floor. */
function crate(g: Ctx) {
	ellipse(g, 288, 199, 18, 2, C.floorDark);
	for (const [x, c] of [
		[277, C.teal],
		[284, C.paper],
		[291, C.heart],
	] as const) {
		rect(g, x, 176, 5, 8, c);
		rect(g, x + 1, 174, 3, 2, C.ink);
	}
	outlined(g, [[272, 182, 30, 16, C.wood]], C.ink);
	rect(g, 272, 182, 30, 1, C.woodTop);
	rect(g, 272, 189, 30, 1, C.woodDark);
	rect(g, 283, 186, 8, 2, C.ink);
}

/** Things put down and left: small enough that a rider may sit beside them. */
function dropped(g: Ctx) {
	// A helmet, vents and all.
	ellipse(g, 54, 146, 7, 4, C.ink);
	ellipse(g, 54, 145, 6, 3, C.teal);
	rect(g, 51, 144, 6, 1, C.tealLight);
	rect(g, 49, 148, 10, 1, C.ink);
	// Shoes, kicked off.
	outlined(g, [[46, 153, 6, 3, C.paper]], C.ink);
	outlined(g, [[54, 155, 6, 3, C.paper]], C.ink);
	rect(g, 46, 155, 6, 1, C.teal);
	rect(g, 54, 157, 6, 1, C.teal);
	// A bottle stood by the other trainer, a towel dropped next to it.
	outlined(g, [[266, 138, 4, 8, C.paper]], C.ink);
	rect(g, 267, 136, 2, 2, C.heart);
	outlined(g, [[262, 150, 13, 4, C.towel]], C.ink);
	rect(g, 262, 150, 13, 1, C.tealLight);
	// A stack of magazines at the rug's edge.
	outlined(g, [[212, 160, 12, 2, C.amber]], C.ink);
	rect(g, 213, 159, 11, 1, C.paper);
	rect(g, 212, 158, 12, 1, C.bookB);
	// The cat's ball of wool, its thread wandering off.
	disc(g, 122, 172, 3, C.ink);
	disc(g, 122, 172, 2, C.heart);
	dot(g, 121, 171, C.paper);
	line(g, 125, 174, 132, 175, C.heart);
	line(g, 132, 175, 138, 173, C.heart);
	// A rolled mat against nothing in particular.
	ellipse(g, 24, 164, 9, 3, C.ink);
	ellipse(g, 24, 163, 8, 2, C.cushionB);
	rect(g, 16, 163, 16, 1, shadeOf(C.cushionB));
}

/** A bike up on a repair stand, a tool chest and a mat under it all. */
function workshop(g: Ctx) {
	const y = FRONT_Y;
	rect(g, 12, y - 7, 76, 10, C.laptop);
	rect(g, 12, y - 7, 76, 1, C.laptopLight);
	rect(g, 12, y + 3, 76, 1, C.ink);
	// The stand: a foot, a post and the clamp holding the frame.
	outlined(
		g,
		[
			[26, y - 2, 22, 2, C.trim],
			[36, y - 24, 2, 22, C.trim],
			[34, y - 27, 6, 3, C.cable],
		],
		C.ink,
	);
	// The bike, hung by its seat post, its wheels clear of the mat.
	for (const cx of [20, 54]) {
		ring(g, cx, y - 20, 8, C.ink);
		ring(g, cx, y - 20, 7, C.lilac);
		dot(g, cx, y - 20, C.trim);
	}
	line(g, 20, y - 20, 32, y - 32, C.violet);
	line(g, 32, y - 32, 48, y - 31, C.violet);
	line(g, 32, y - 32, 36, y - 20, C.violet);
	line(g, 36, y - 20, 20, y - 20, C.violet);
	line(g, 36, y - 20, 48, y - 31, C.violet);
	line(g, 48, y - 33, 54, y - 20, C.violet);
	rect(g, 28, y - 35, 7, 2, C.ink);
	rect(g, 47, y - 36, 5, 2, C.ink);
	// The chest: three drawers, a toolbox on top.
	ellipse(g, 74, y + 1, 13, 1, C.floorDark);
	outlined(g, [[63, y - 25, 22, 25, C.red]], C.ink);
	rect(g, 63, y - 25, 22, 2, C.redLight);
	for (const row of [y - 21, y - 14, y - 7]) {
		rect(g, 65, row, 18, 5, shadeOf(C.red));
		rect(g, 71, row + 1, 6, 1, C.paper);
	}
	outlined(g, [[67, y - 30, 13, 4, C.cable]], C.ink);
	rect(g, 71, y - 32, 5, 1, C.ink);
	// The floor pump, its hose in a loop.
	outlined(g, [[88, y - 22, 2, 22, C.cable]], C.ink);
	rect(g, 84, y - 1, 10, 1, C.ink);
	rect(g, 85, y - 23, 8, 1, C.ink);
	line(g, 90, y - 16, 93, y - 8, C.ink);
}

/** Two beanbags on a little rug, a lamp between them, a plant at the end. */
function nook(g: Ctx) {
	const y = FRONT_Y;
	ellipse(g, 134, y - 2, 46, 11, C.ink);
	ellipse(g, 134, y - 2, 45, 10, shadeOf(C.cushionB));
	ellipse(g, 134, y - 2, 41, 8, C.cushionB);
	ellipse(g, 134, y - 2, 36, 6, shadeOf(C.cushionB));
	const bag = (x: number, c: string, light: string) => {
		ellipse(g, x, y + 1, 14, 2, C.floorDark);
		ellipse(g, x, y - 6, 13, 8, C.ink);
		ellipse(g, x, y - 6, 12, 7, c);
		ellipse(g, x - 3, y - 9, 6, 3, light);
		ellipse(g, x, y - 1, 11, 1, shadeOf(c));
	};
	bag(104, C.cushionA, C.heart);
	// The lamp's foot, stem and shade.
	ellipse(g, NOOK_X, y, 5, 1, C.ink);
	outlined(
		g,
		[
			[NOOK_X - 1, y - 32, 2, 32, C.trim],
			[NOOK_X - 6, y - 42, 12, 9, C.woodLight],
		],
		C.ink,
	);
	rect(g, NOOK_X - 6, y - 42, 12, 1, C.woodTop);
	rect(g, NOOK_X - 5, y - 33, 10, 1, C.bulb);
	bag(146, C.cushionC, C.amber);
	// The plant.
	ellipse(g, 180, y + 1, 9, 1, C.floorDark);
	for (let i = 0; i < 7; i++) {
		const a = -1 + (i / 6) * 2;
		const tx = 180 + Math.sin(a) * 14;
		const ty = y - 14 - Math.cos(a) * 18;
		line(g, 180, y - 12, tx, ty, i % 2 ? C.leaf : C.leafLight);
		ellipse(
			g,
			Math.round(tx),
			Math.round(ty),
			2,
			1,
			i % 2 ? C.leaf : C.leafLight,
		);
	}
	outlined(g, [[174, y - 12, 12, 12, C.woodLight]], C.ink);
	rect(g, 173, y - 12, 14, 2, C.wood);
}

/** The arcade cabinet: its screen plays in drawLive. */
function cabinet(g: Ctx) {
	const y = FRONT_Y;
	ellipse(g, 233, y + 1, 13, 1, C.floorDark);
	outlined(
		g,
		[
			[223, y - 40, 21, 40, C.laptop],
			[221, y - 20, 25, 4, C.laptopLight],
		],
		C.ink,
	);
	rect(g, 223, y - 40, 21, 5, C.frame);
	rect(g, 226, y - 33, 15, 11, C.screen);
	rect(g, 226, y - 19, 3, 2, C.heart);
	rect(g, 231, y - 19, 2, 2, C.teal);
	rect(g, 235, y - 19, 2, 2, C.amber);
	rect(g, 226, y - 12, 15, 1, C.laptopLight);
}

/** The counter with its espresso machine and cups, two stools at it. */
function bar(g: Ctx) {
	const y = FRONT_Y;
	rect(g, 254, y + 1, 56, 1, C.floorDark);
	outlined(g, [[254, y - 23, 56, 23, C.wood]], C.ink);
	rect(g, 254, y - 23, 56, 1, C.woodTop);
	rect(g, 254, y - 22, 56, 3, C.woodLight);
	for (let x = 258; x < 306; x += 9) rect(g, x, y - 17, 1, 15, C.woodDark);
	// The machine: its body, the group head and the pressure gauge.
	outlined(
		g,
		[
			[270, y - 36, 18, 13, C.cable],
			[273, y - 26, 12, 3, C.laptop],
		],
		C.ink,
	);
	rect(g, 270, y - 36, 18, 2, C.paper);
	disc(g, 275, y - 31, 2, C.paper);
	dot(g, 275, y - 31, C.red);
	rect(g, 281, y - 32, 4, 1, C.red);
	// Cups stacked on the counter, a tin of beans.
	outlined(g, [[292, y - 27, 4, 4, C.paper]], C.ink);
	rect(g, 293, y - 31, 4, 3, C.paper);
	rect(g, 292, y - 32, 6, 1, C.ink);
	outlined(g, [[259, y - 30, 6, 7, C.amberDark]], C.ink);
	rect(g, 259, y - 28, 6, 2, C.paper);
	// The stools, a step nearer than the counter.
	for (const x of [266, 296]) {
		ellipse(g, x, y + 11, 6, 1, C.floorDark);
		rect(g, x - 3, y + 3, 1, 8, C.ink);
		rect(g, x + 3, y + 3, 1, 8, C.ink);
		ellipse(g, x, y + 2, 6, 2, C.ink);
		ellipse(g, x, y + 1, 5, 1, C.bookC);
	}
}

/** The front row, in stage coordinates. */
export function frontRow(g: Ctx) {
	dropped(g);
	spares(g);
	crate(g);
	workshop(g);
	nook(g);
	cabinet(g);
	bar(g);
}

/**
 * Close to the eye at the very bottom, out of the light: a plant's leaves
 * and a stool's top. Room pixels: it hangs on the room's corners, wherever
 * they land.
 */
export function foreground(g: Ctx, w: number, h: number, oy: number) {
	if (h - oy < FRONT_Y + FOREGROUND_ROWS) return;
	const spray = (x0: number, dir: number, size: number, leaves: number) => {
		for (let i = 0; i < leaves; i++) {
			const a = 0.12 + (i / leaves) * 1.35;
			const far = size * (0.75 + (i % 3) * 0.2);
			const tip = [x0 + Math.sin(a) * far * dir, h - Math.cos(a) * far];
			limb(
				g,
				[x0, h + 2],
				tip,
				3,
				i % 2 ? C.leafDark : shadeOf(C.leafDark),
				C.ink,
			);
			ellipse(g, Math.round(tip[0]), Math.round(tip[1]), 5, 3, C.ink);
			ellipse(
				g,
				Math.round(tip[0]),
				Math.round(tip[1]),
				4,
				2,
				i % 2 ? C.leafDark : shadeOf(C.leafDark),
			);
		}
	};
	spray(2, 1, 46, 7);
	spray(w + 2, -1, 28, 5);
}
