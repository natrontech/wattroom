/**
 * What the calendar puts in the room (moments.ts): Easter's eggs hidden
 * where a rider has to look for them, Samichlaus's bread man and sack, the
 * lanterns and the flag of the first of August, and confetti. All of it is
 * drawn with the room, but for what falls and the fondue's steam.
 */
import { LOUNGE as C } from '#lib/lounge/palette.ts';
import {
	dot,
	ellipse,
	line,
	outlined,
	rect,
	type Ctx,
} from '#lib/lounge/pixel.ts';
import type { SceneInput } from '#lib/lounge/scene.ts';
import type { Moment } from '#lib/lounge/moments.ts';
import { hash3 } from '#lib/lounge/hash.ts';

/** Tucked behind and under things: none of them in the open. */
const EGGS = [
	[28, 80, 'heart'],
	[99, 81, 'teal'],
	[217, 83, 'amber'],
	[284, 25, 'lilac'],
	[188, 106, 'heart'],
	[71, 42, 'amber'],
] as const;

function eggs(g: Ctx) {
	for (const [x, y, hue] of EGGS) {
		outlined(
			g,
			[
				[x + 1, y, 2, 1, C[hue]],
				[x, y + 1, 4, 3, C[hue]],
			],
			C.ink,
		);
		rect(g, x, y + 2, 4, 1, C.paper);
	}
}

/** The bread man on the table, mandarins beside him, a red sack by the desk. */
function samichlaus(g: Ctx) {
	outlined(
		g,
		[
			[158, 102, 4, 4, C.amberDark],
			[156, 106, 8, 3, C.amberDark],
			[157, 109, 6, 2, C.amberDark],
		],
		C.ink,
	);
	dot(g, 159, 103, C.ink);
	dot(g, 160, 103, C.ink);
	for (const x of [150, 167]) {
		outlined(g, [[x, 108, 3, 2, C.amber]], C.ink);
		dot(g, x + 1, 108, C.paper);
	}
	ellipse(g, 96, 96, 11, 2, C.floorDark);
	ellipse(g, 96, 89, 9, 7, C.ink);
	ellipse(g, 96, 89, 8, 6, C.red);
	ellipse(g, 93, 86, 3, 2, C.redLight);
	rect(g, 94, 81, 4, 2, C.amberDark);
}

/** The first of August: paper lanterns on the curtain rod, a flag on the table. */
function august(g: Ctx) {
	for (const [x, hue] of [
		[108, C.red],
		[212, C.paper],
		[236, C.red],
	] as const) {
		rect(g, x, 6, 1, 3, C.ink);
		outlined(g, [[x - 2, 9, 5, 5, hue]], C.ink);
		rect(g, x - 2, 11, 5, 1, C.amber);
	}
	line(g, 150, 110, 150, 96, C.woodLight);
	outlined(g, [[151, 96, 9, 7, C.red]], C.ink);
	rect(g, 154, 97, 3, 5, C.paper);
	rect(g, 152, 98, 7, 1, C.paper);
	rect(g, 152, 99, 7, 1, C.paper);
}

export function momentDressing(g: Ctx, moment: Moment) {
	if (moment === 'easter') eggs(g);
	else if (moment === 'samichlaus') samichlaus(g);
	else if (moment === 'august') august(g);
}

/** Fasnacht and New Year: confetti, falling the whole height of the room. */
export function drawConfetti(g: Ctx, s: SceneInput) {
	if (s.moment !== 'fasnacht' && s.moment !== 'newyear') return;
	const hues = [C.heart, C.teal, C.amber, C.lilac, C.redLight];
	for (let i = 0; i < 80; i++) {
		const speed = 10 + hash3(i, 8, 3) * 12;
		const fall = (hash3(i, 8, 1) * s.h + (s.still ? 0 : s.t * speed)) % s.h;
		const sway = s.still ? 0 : Math.sin(s.t + i) * 3;
		const flip = !s.still && Math.floor(s.t * 3 + i) % 2 === 0;
		rect(
			g,
			hash3(i, 8, 2) * s.w + sway,
			fall,
			flip ? 1 : 2,
			flip ? 2 : 1,
			hues[i % hues.length],
		);
	}
}

/** The caquelon on its burner, bread forks in it, steam rising. */
export function drawFondue(g: Ctx, s: SceneInput) {
	outlined(g, [[154, 110, 12, 2, C.cable]], C.ink);
	dot(g, 160, 112, C.amber);
	ellipse(g, 160, 107, 8, 4, C.ink);
	ellipse(g, 160, 107, 7, 3, C.red);
	ellipse(g, 160, 105, 6, 1, C.bulb);
	line(g, 155, 104, 150, 99, C.cable);
	line(g, 165, 104, 170, 100, C.cable);
	dot(g, 150, 98, C.amberDark);
	dot(g, 170, 99, C.amberDark);
	for (let i = 0; i < 3; i++)
		dot(
			g,
			160 + (s.still ? 0 : Math.round(Math.sin(s.t * 2 + i * 1.7))),
			102 - i * 2,
			C.paper,
		);
}

/** How long a celebration's confetti flies, of the cheer's few seconds (standing.ts). */
const CHEER_FLIES = 3;
/** How fast the burst's air stops it, a second, and how fast it then flutters down. */
const CHEER_DRAG = 3;
const CHEER_FALL = 7;

/**
 * A level or a week of rider streak gained: confetti bursts up over the
 * rider's head in a fan, stops in the air and flutters down. Held still,
 * it hangs over them for the whole of it.
 */
export function drawCheers(g: Ctx, s: SceneInput) {
	const hues = [C.amber, C.teal, C.heart, C.lilac, C.paper];
	for (const c of s.cheers ?? []) {
		const age = s.t - c.born;
		if (age < 0 || age > CHEER_FLIES) continue;
		const t = s.still ? 1 : age;
		const out = 1 - Math.exp(-CHEER_DRAG * t);
		for (let i = 0; i < 36; i++) {
			const angle = Math.PI * (1 + hash3(i, 9, 1));
			const reach = (60 + hash3(i, 9, 2) * 60) / CHEER_DRAG;
			const sway = s.still ? 0 : Math.sin(s.t * 4 + i) * t;
			const x = c.x + Math.cos(angle) * reach * out + sway;
			const y = c.y + Math.sin(angle) * reach * out + CHEER_FALL * t;
			const flip = !s.still && Math.floor(s.t * 6 + i) % 2 === 0;
			rect(g, x, y, flip ? 1 : 2, flip ? 2 : 1, hues[i % hues.length]);
		}
	}
}
