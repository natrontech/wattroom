/**
 * Who is in the voice channel: on the sofa, on a cushion around the rug once
 * the sofa is full, on the bike when they ride. What can be told from across
 * the room is drawn on the figure: a speech bubble and a moving mouth while
 * they talk, headphones while their mic is off, the seat holding what they
 * went for while they are away, a dithered figure while their link is down.
 * Their names and the quieter marks hang under them in the page
 * (LoungeScene). The watts above the bike are the picture's one live number,
 * in the theme's watt hue, and the only thing that glows (ADR-0005).
 */
import { PEDAL_FRAMES, drawCyclist } from '$lib/lounge/draw-rider';
import { LOUNGE as C, shadeOf } from '$lib/lounge/palette';
import {
	ellipse,
	inkedSprite,
	line,
	outlined,
	rect,
	sprite,
	text,
	textWidth,
	type Ctx,
	type Part,
} from '$lib/lounge/pixel';
import {
	BIKE_GROUND,
	SEAT_BASE,
	SEAT_XS,
	pulseOf,
	type Bike,
	type Figure,
	type SceneInput,
} from '$lib/lounge/scene';

const NOTE = ['011', '010', '110'];
const HEART = ['01010', '11111', '01110', '00100'];
const BUBBLE = [
	'01111110',
	'11111111',
	'11111111',
	'11111111',
	'01111110',
	'01100000',
	'01000000',
];
/** What an away seat holds, by $lib/away's reasons; '' is plain away, a mug. */
const LEFT_BEHIND: Record<string, { rows: string[]; colour: keyof typeof C }> =
	{
		'': { rows: ['1111', '1111', '1111', '0110'], colour: 'lilac' },
		food: { rows: ['111111', '011110'], colour: 'amber' },
		nature: { rows: ['111', '111', '111', '111'], colour: 'paper' },
		shower: { rows: ['11111', '11111', '01010'], colour: 'towel' },
	};

export type Pose = 'sofa' | 'floor';

/** Seat n of the sofa, or a cushion: everyone sits facing the room. */
export function drawSofaCrew(g: Ctx, s: SceneInput) {
	s.crew.seated.forEach((f, i) => {
		if (!f) return;
		const x = SEAT_XS[i];
		if (f.away === undefined) sitter(g, s, f, x, SEAT_BASE, i, 'sofa');
		else leftBehind(g, f, x, SEAT_BASE);
	});
}

/** The cushions around the rug and the bike, back to front so the nearer covers the farther. */
export function drawFloorCrew(g: Ctx, s: SceneInput) {
	const n0 = s.crew.seated.length;
	const items: { y: number; draw: () => void }[] = s.crew.floor.map(
		({ f, x, y }, i) => ({
			y,
			draw: () => {
				cushion(g, f.cushion, x, y);
				if (f.away !== undefined) leftBehind(g, f, x, y - 1);
				else sitter(g, s, f, x, y - 1, n0 + i, 'floor');
			},
		}),
	);
	s.crew.placed.forEach(({ f, x, y }, i) =>
		items.push({
			y,
			draw: () => {
				if (f.away !== undefined) leftBehind(g, f, x, y - 1);
				else sitter(g, s, f, x, y - 1, n0 + 40 + i, 'floor');
			},
		}),
	);
	for (const b of s.crew.bikes)
		items.push({ y: b.y, draw: () => bike(g, s, b) });
	items.sort((a, b) => a.y - b.y);
	for (const item of items) item.draw();
	if (!s.crew.more || !s.crew.floor.length) return;
	const last = s.crew.floor[s.crew.floor.length - 1];
	text(g, `+${s.crew.more}`, last.x + 10, last.y - 9, C.lilac);
}

function cushion(g: Ctx, colour: string, x: number, y: number) {
	ellipse(g, x, y, 9, 3, C.ink);
	ellipse(g, x, y, 8, 2, colour);
	rect(g, x - 5, y + 2, 11, 1, shadeOf(colour));
}

/** Whether seat n has its arms up: the wave runs along the crew in order. */
function waving(s: SceneInput, n: number): boolean {
	const into = s.t - s.waveAt - n * 0.18;
	return !s.still && into >= 0 && into < 0.6;
}

/** A blink every few seconds, each figure on its own beat. */
function blinking(s: SceneInput, n: number): boolean {
	return !s.still && (s.t + n * 1.7) % 4.3 < 0.15;
}

const UNDER_A_CAP = [2, 4, 8, 11];

/**
 * Hair by style, over a head whose left edge is hx and top row ht, and the
 * cap over it. Under a cap a bun or a mohawk is cut to short hair.
 */
export function hair(f: Figure, hx: number, ht: number): Part[] {
	// A bun, a mohawk, an afro and a top knot go under a cap cut short.
	const h = f.hair;
	const style = f.cap && UNDER_A_CAP.includes(f.hairStyle) ? 0 : f.hairStyle;
	const cap: Part[] = f.cap
		? [
				[hx - 1, ht - 1, 12, 3, f.cap],
				[hx - 1, ht + 2, 12, 1, shadeOf(f.cap)],
			]
		: [];
	return [...locks(f, h, style, hx, ht), ...cap];
}

function locks(
	f: Figure,
	h: string,
	style: number,
	hx: number,
	ht: number,
): Part[] {
	switch (style) {
		case 1:
			return [
				[hx - 1, ht, 12, 3, h],
				[hx - 1, ht + 3, 2, 9, h],
				[hx + 9, ht + 3, 2, 9, h],
			];
		case 2:
			return [
				[hx + 3, ht - 3, 4, 3, h],
				[hx, ht, 10, 3, h],
				[hx, ht + 3, 1, 2, h],
				[hx + 9, ht + 3, 1, 2, h],
			];
		case 3:
			return [
				[hx - 1, ht - 1, 12, 4, f.shirtShade],
				[hx, ht + 3, 1, 2, h],
				[hx + 9, ht + 3, 1, 2, h],
			];
		case 4:
			return [[hx + 4, ht - 4, 2, 6, h]];
		case 5:
			return [
				[hx - 2, ht - 2, 14, 5, h],
				[hx - 2, ht + 3, 2, 5, h],
				[hx + 10, ht + 3, 2, 5, h],
			];
		case 6:
			return [
				[hx, ht, 10, 3, h],
				[hx, ht + 3, 1, 2, h],
				[hx + 10, ht + 1, 2, 3, h],
				[hx + 11, ht + 4, 2, 5, h],
			];
		case 7:
			return [];
		case 8:
			return [
				[hx - 3, ht - 4, 16, 7, h],
				[hx - 3, ht + 3, 3, 4, h],
				[hx + 10, ht + 3, 3, 4, h],
			];
		case 9:
			return [
				[hx, ht, 10, 3, h],
				[hx - 1, ht + 3, 2, 10, h],
				[hx + 9, ht + 3, 2, 10, h],
			];
		case 10:
			return [
				[hx, ht, 10, 2, h],
				[hx + 3, ht + 2, 7, 1, h],
				[hx, ht + 2, 1, 3, h],
				[hx + 9, ht + 3, 1, 2, h],
			];
		case 11:
			return [
				[hx + 3, ht - 4, 4, 2, h],
				[hx + 4, ht - 2, 2, 2, h],
				[hx, ht, 10, 2, h],
				[hx, ht + 2, 1, 3, h],
				[hx + 9, ht + 2, 1, 3, h],
			];
		default:
			return [
				[hx, ht, 10, 3, h],
				[hx, ht + 3, 1, 2, h],
				[hx + 9, ht + 3, 1, 2, h],
			];
	}
}

/**
 * Someone sitting, centred at x, their seat at row base: a 12 × 19 figure
 * outlined in ink, lit from the top left.
 */
function sitter(
	g: Ctx,
	s: SceneInput,
	f: Figure,
	x: number,
	base: number,
	n: number,
	pose: Pose,
) {
	const draw = (g: Ctx, x: number, base: number) => {
		const hx = x - 5;
		const ht = base - 19;
		const wave =
			waving(s, n) ||
			f.emote === 'stretch' ||
			f.doing === 'stretch' ||
			(f.emote === 'wave' && (s.still || Math.floor(s.t * 4) % 2 === 0)) ||
			(f.emote === 'dance' && Math.floor(s.t * 4 + n) % 4 === 0);
		const parts: Part[] = [
			// A hood lies on the shoulders, behind the head.
			...(f.top === 1
				? ([[x - 6, base - 12, 12, 3, f.shirtShade]] as Part[])
				: []),
			[hx, ht, 10, 9, f.skin],
			[x - 6, base - 10, 12, 7, f.shirt],
			...(pose === 'sofa'
				? ([
						[x - 5, base - 4, 10, 4, f.pants],
						[x - 4, base, 3, 6, f.pantsShade],
						[x + 1, base, 3, 6, f.pantsShade],
					] as Part[])
				: ([[x - 6, base - 4, 12, 4, f.pants]] as Part[])),
			...(wave
				? ([
						[x - 8, base - 18, 2, 9, f.shirt],
						[x + 6, base - 18, 2, 9, f.shirt],
					] as Part[])
				: []),
			...hair(f, hx, ht),
		];
		if (f.muted)
			parts.push(
				[hx - 2, ht + 3, 2, 4, C.lilac],
				[hx + 10, ht + 3, 2, 4, C.lilac],
			);
		outlined(g, parts, C.ink);
		// Shade on the right and under the chin; the top's own marks; the arms and hands.
		rect(g, hx + 9, ht + 3, 1, 6, f.skinShade);
		rect(g, hx + 1, ht + 8, 8, 1, f.skinShade);
		if (f.stripes)
			for (const y of [base - 8, base - 6])
				rect(g, x - 6, y, 12, 1, stripeOn(f.shirt));
		topMarks(g, f, x, base);
		rect(g, x + 4, base - 10, 2, 7, f.shirtShade);
		// The scarf over all of the top, its end hanging down the front.
		if (f.scarf)
			outlined(
				g,
				[
					[x - 5, base - 11, 10, 2, f.scarf],
					[x + 1, base - 9, 2, 4, f.scarf],
				],
				C.ink,
			);
		// Just off the bike: a towel over the top of everything, ends down the front.
		if (f.cooling)
			outlined(
				g,
				[
					[x - 5, base - 11, 10, 2, C.paper],
					[x - 4, base - 9, 2, 3, C.paper],
					[x + 2, base - 9, 2, 3, C.paper],
				],
				C.ink,
			);
		if (!wave) {
			rect(g, x - 4, base - 9, 1, 5, f.shirtShade);
			rect(g, x + 3, base - 9, 1, 5, f.shirtShade);
			// A tee's sleeves end at the elbow, and a vest has none.
			if (f.top === 0 || f.top === 4) {
				rect(g, x - 4, base - 6, 1, 2, f.skin);
				rect(g, x + 3, base - 6, 1, 2, f.skin);
			}
			if (f.top === 4) {
				rect(g, x - 4, base - 9, 1, 3, f.skin);
				rect(g, x + 3, base - 9, 1, 3, f.skin);
			}
			rect(g, x - 5, base - 4, 2, 1, f.skin);
			rect(g, x + 3, base - 4, 2, 1, f.skin);
		} else {
			rect(g, x - 8, base - 19, 2, 2, f.skin);
			rect(g, x + 6, base - 19, 2, 2, f.skin);
		}
		if (pose === 'sofa') {
			if (f.socks) {
				rect(g, x - 4, base + 3, 3, 2, f.socks);
				rect(g, x + 1, base + 3, 3, 2, f.socks);
			}
			rect(g, x - 4, base + 5, 3, 1, f.shoes);
			rect(g, x + 1, base + 5, 3, 1, f.shoes);
		} else {
			rect(g, x - 1, base - 4, 2, 1, f.pantsShade);
			rect(g, x - 6, base - 1, 12, 1, f.pantsShade);
			rect(g, x - 6, base - 2, 2, 1, f.shoes);
			rect(g, x + 4, base - 2, 2, 1, f.shoes);
		}
		// Eyes, a blink now and then, and a mouth that moves while they talk.
		const ey = ht + 5;
		const shut = blinking(s, n) || f.doing === 'nap';
		rect(g, hx + 2, shut ? ey + 1 : ey, 1, shut ? 1 : 2, C.ink);
		rect(g, hx + 7, shut ? ey + 1 : ey, 1, shut ? 1 : 2, C.ink);
		const open = f.speaking && !s.still && Math.floor(s.t * 6 + n) % 2 === 0;
		rect(g, hx + 4, ht + 7, 2, open ? 2 : 1, open ? C.ink : f.skinShade);
		beard(g, f, hx, ht, open);
		specs(g, f, hx, ey);
		badge(g, f, x, base);
		if (f.muted) {
			rect(g, hx - 1, ht - 2, 12, 1, C.cable);
			rect(g, hx - 2, ht - 1, 1, 4, C.cable);
			rect(g, hx + 11, ht - 1, 1, 4, C.cable);
		}
	};
	// Dancing steps side to side on the beat; nodding along dips with the kick.
	const dancing = f.emote === 'dance' && !s.still;
	const dx = dancing ? (Math.floor(s.t * 2 + n) % 2 ? 1 : -1) : 0;
	const dy =
		(dancing && Math.floor(s.t * 4 + n) % 2 ? 1 : 0) +
		(f.doing === 'nod' && !s.still && pulseOf(s) > 0.6 ? -1 : 0);
	if (f.faded) faded(g, x, base, draw);
	else draw(g, x + dx, base - dy);
	drawDoing(g, s, f, x + dx, base - dy, n);
	drawPet(g, s, f, x + dx, base - dy, pose, n);
	if (f.cooling) {
		// A bottle held at the hip, and a drop that runs now and then.
		outlined(g, [[x + 7, base - 9, 3, 6, C.teal]], C.ink);
		rect(g, x + 8, base - 11, 1, 2, C.paper);
		if (!s.still && Math.floor(s.t + n) % 4 === 0)
			rect(g, x - 7, base - 16 + Math.floor((s.t % 1) * 6), 1, 1, C.tealLight);
	}
	if (f.speaking) bubble(g, x + 4, base - 29, s);
	if (f.sounding)
		sprite(g, NOTE, f.speaking ? x - 8 : x + 6, base - 27, C.lilac);
}

/** Stripes that read on the top: dark on a light one, light on a dark one. */
/** Stubble, a moustache or a beard, with the mouth left to move through it. */
export function beard(
	g: Ctx,
	f: Figure,
	hx: number,
	ht: number,
	open: boolean,
) {
	if (f.beard === 1)
		for (let i = 1; i < 9; i += 2) rect(g, hx + i, ht + 8, 1, 1, f.skinShade);
	else if (f.beard === 2) rect(g, hx + 3, ht + 6, 4, 1, f.hair);
	else if (f.beard === 3) {
		rect(g, hx + 1, ht + 6, 8, 3, f.hair);
		rect(g, hx + 3, ht + 7, 4, open ? 2 : 1, open ? C.ink : f.skinShade);
	}
}

/** A small badge on the chest: a star, a heart or a bolt. */
export function badge(g: Ctx, f: Figure, x: number, base: number) {
	const bx = x - 5;
	const by = base - 9;
	if (f.badge === 1) {
		rect(g, bx + 1, by, 1, 3, C.amber);
		rect(g, bx, by + 1, 3, 1, C.amber);
	} else if (f.badge === 2) {
		rect(g, bx, by, 1, 1, C.heart);
		rect(g, bx + 2, by, 1, 1, C.heart);
		rect(g, bx, by + 1, 3, 1, C.heart);
		rect(g, bx + 1, by + 2, 1, 1, C.heart);
	} else if (f.badge === 3) {
		rect(g, bx + 1, by, 2, 1, C.amber);
		rect(g, bx, by + 1, 3, 1, C.amber);
		rect(g, bx, by + 2, 2, 1, C.amber);
	}
}

/** Pets as rows of letters: b its body, k its eye and nose, t and r a parrot's. */
export const PET_ROWS: Record<number, readonly string[]> = {
	1: ['.b..b....', '.bbbb...b', 'bkbkbbbbb', '.bbbbbbb.', '.b.b.b.b.'],
	2: ['.tt.', 'tkt.', 'ttr.', '.tt.', '.t..'],
	3: ['b..b', 'bbbb', 'kbkb', 'bbbb'],
};

/**
 * Their pet: a dog at their feet, a parrot on their shoulder, a hamster on
 * their head. The dog wags and the parrot shifts now and then.
 */
function drawPet(
	g: Ctx,
	s: SceneInput,
	f: Figure,
	x: number,
	base: number,
	pose: Pose,
	n: number,
) {
	if (!f.pet) return;
	const rows = PET_ROWS[f.pet];
	const body = f.pet === 3 ? C.amber : C.woodLight;
	const colour: Record<string, string> = {
		b: body,
		k: C.ink,
		t: C.teal,
		r: C.redLight,
	};
	const tick = s.still ? 0 : Math.floor(s.t * 3 + n) % 8;
	const px =
		f.pet === 1 ? x + 7 : f.pet === 2 ? x + 6 + (tick === 0 ? 1 : 0) : x - 2;
	const py =
		f.pet === 1
			? base + (pose === 'sofa' ? 12 : 2)
			: f.pet === 2
				? base - 15
				: base - 24;
	rows.forEach((row, j) => {
		for (let i = 0; i < row.length; i++)
			if (row[i] !== '.') rect(g, px + i, py + j, 1, 1, colour[row[i]]);
	});
	if (f.pet === 1 && !s.still && tick < 2) rect(g, px + 8, py, 1, 1, body);
}

/** What their hands are up to, over the figure. */
function drawDoing(
	g: Ctx,
	s: SceneInput,
	f: Figure,
	x: number,
	base: number,
	n: number,
) {
	if (f.emote === 'cheers') {
		// A mug held up, and a glint off it.
		outlined(g, [[x + 7, base - 22, 3, 4, C.lilac]], C.ink);
		rect(g, x + 8, base - 25, 1, 1, C.bulb);
		rect(g, x + 11, base - 23, 1, 1, C.bulb);
		return;
	}
	switch (f.doing) {
		case 'sip':
		case 'coffee': {
			const up = !s.still && (s.t + n * 1.3) % 6 < 1.4;
			outlined(g, [[x + 4, base - (up ? 13 : 9), 3, 3, C.lilac]], C.ink);
			if (f.doing === 'coffee' && !s.still && Math.floor(s.t + n) % 2 === 0)
				rect(g, x + 5, base - 13, 1, 2, C.paper);
			break;
		}
		case 'read':
			outlined(g, [[x - 5, base - 9, 10, 5, C.bookC]], C.ink);
			rect(g, x - 1, base - 9, 2, 5, C.paper);
			break;
		case 'phone':
			outlined(g, [[x - 2, base - 8, 4, 5, C.screen]], C.ink);
			rect(g, x - 1, base - 7, 2, 3, C.tealLight);
			break;
		case 'nap':
			if (s.still || Math.floor(s.t / 2 + n) % 2 === 0)
				text(
					g,
					'Z',
					x + 7,
					base - 25 - (s.still ? 0 : Math.floor(s.t % 2) * 2),
					C.lilac,
				);
			break;
		case 'warm':
			rect(g, x - 7, base - 8, 2, 2, f.skin);
			rect(g, x + 5, base - 8, 2, 2, f.skin);
			break;
		case 'type':
			if (!s.still && Math.floor(s.t * 5 + n) % 2 === 0)
				rect(g, x - 3, base - 7, 6, 1, f.skin);
			break;
		case 'play':
			if (!s.still && Math.floor(s.t * 6 + n) % 2 === 0)
				rect(g, x + 4, base - 11, 2, 2, f.skin);
			break;
		case 'wrench': {
			const swing = s.still ? 0 : Math.round(Math.sin(s.t * 3 + n) * 2);
			line(g, x + 5, base - 8, x + 10, base - 12 + swing, C.cable);
			break;
		}
	}
}

export function stripeOn(shirt: string): string {
	const n = parseInt(shirt.slice(1), 16);
	const light = 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
	return light > 150 ? C.ink : C.paper;
}

/** What tells the tops apart: a hoodie's strings and pocket, a jersey's zip, a sweater's neck and hem. */
export function topMarks(g: Ctx, f: Figure, x: number, base: number) {
	if (f.top === 1) {
		rect(g, x - 2, base - 10, 1, 2, C.paper);
		rect(g, x + 1, base - 10, 1, 2, C.paper);
		rect(g, x - 3, base - 6, 6, 1, f.shirtShade);
	} else if (f.top === 2) {
		rect(g, x - 2, base - 10, 4, 1, f.shirtShade);
		rect(g, x, base - 9, 1, 5, f.shirtShade);
	} else if (f.top === 3) {
		rect(g, x - 2, base - 10, 4, 1, f.shirtShade);
		for (let i = -6; i < 6; i += 2)
			rect(g, x + i, base - 5, 1, 1, f.shirtShade);
	} else if (f.top === 4) {
		rect(g, x - 2, base - 10, 4, 2, f.skin);
		rect(g, x - 1, base - 9, 2, 2, f.skin);
	} else if (f.top === 5) {
		rect(g, x, base - 10, 1, 7, f.shirtShade);
		rect(g, x - 6, base - 6, 12, 1, C.paper);
		rect(g, x - 3, base - 11, 6, 1, f.shirtShade);
	}
}

/** Round frames over the eyes, or dark lenses on them, eye row ey. */
export function specs(g: Ctx, f: Figure, hx: number, ey: number) {
	if (f.glasses === 1) {
		for (const lx of [hx + 1, hx + 6]) {
			rect(g, lx, ey - 1, 3, 1, C.ink);
			rect(g, lx, ey + 2, 3, 1, C.ink);
			rect(g, lx, ey, 1, 1, C.paper);
		}
		rect(g, hx + 4, ey - 1, 2, 1, C.ink);
	} else if (f.glasses === 2) {
		rect(g, hx + 1, ey, 3, 2, C.ink);
		rect(g, hx + 6, ey, 3, 2, C.ink);
		rect(g, hx + 4, ey, 2, 1, C.ink);
	}
}

/** One figure on its own, sitting with its seat at row base: the look editor's preview. */
export function drawFigure(g: Ctx, f: Figure, x: number, base: number) {
	sitter(
		g,
		{ t: 0, still: true, waveAt: -Infinity } as SceneInput,
		f,
		x,
		base,
		0,
		'sofa',
	);
}

/** A bubble with three dots that fill in turn, ink-edged so it reads on any wall. */
function bubble(g: Ctx, x: number, y: number, s: SceneInput) {
	inkedSprite(g, BUBBLE, x, y, C.paper, C.ink);
	const dots = s.still ? 3 : 1 + (Math.floor(s.t * 4) % 3);
	for (let i = 0; i < dots; i++) rect(g, x + 1 + i * 2, y + 2, 1, 1, C.ink);
}

let drawn: HTMLCanvasElement | undefined;
let ghost: HTMLCanvasElement | undefined;
const FADE_W = 48;
const FADE_H = 64;

/**
 * A figure whose link dropped: every colour turned to one lilac, its shape,
 * outline and face kept, until it redials. A see-through figure or a dither
 * would lose the shape at this size.
 */
function faded(
	g: Ctx,
	x: number,
	base: number,
	draw: (g: Ctx, x: number, base: number) => void,
) {
	const make = () =>
		Object.assign(document.createElement('canvas'), {
			width: FADE_W,
			height: FADE_H,
		});
	drawn ??= make();
	ghost ??= make();
	const a = drawn.getContext('2d')!;
	const b = ghost.getContext('2d')!;
	const cx = FADE_W / 2;
	const cy = 40;
	a.clearRect(0, 0, FADE_W, FADE_H);
	draw(a, cx, cy);
	b.clearRect(0, 0, FADE_W, FADE_H);
	b.drawImage(drawn, 0, 0);
	b.globalCompositeOperation = 'color';
	rect(b, 0, 0, FADE_W, FADE_H, C.cable);
	b.globalCompositeOperation = 'destination-in';
	b.drawImage(drawn, 0, 0);
	b.globalCompositeOperation = 'source-over';
	g.drawImage(ghost, x - cx, base - cy);
}

function leftBehind(g: Ctx, f: Figure, x: number, base: number) {
	const thing = LEFT_BEHIND[f.away ?? ''] ?? LEFT_BEHIND[''];
	const w = thing.rows[0].length;
	inkedSprite(
		g,
		thing.rows,
		x - Math.floor(w / 2),
		base - thing.rows.length,
		C[thing.colour],
		C.ink,
	);
}

/** The trainer drawn at the rug's right, facing left; the others are moved and turned from it. */
export const AT_X = 263;

/**
 * A bike on its trainer, facing the rug, and its rider: the road's own cyclist
 * (draw-rider.ts). Unridden, a towel hangs over the bars.
 */
function bike(g: Ctx, s: SceneInput, b: Bike) {
	const dx = b.x - AT_X;
	const dy = b.y - BIKE_GROUND;
	const rider = b.rider;
	g.save();
	g.translate(dx, dy);
	// Turned about its own middle column, so it stays on whole pixels.
	if (b.face > 0) {
		g.translate(AT_X * 2 + 1, 0);
		g.scale(-1, 1);
	}
	ellipse(g, AT_X, BIKE_GROUND + 1, 24, 1, C.floorDark);
	outlined(
		g,
		[
			[AT_X + 10, BIKE_GROUND - 2, 12, 2, C.cable],
			[AT_X - 22, BIKE_GROUND - 1, 12, 1, C.cable],
		],
		C.ink,
	);
	const stroke = ((rider?.crank ?? 0.9) / (Math.PI * 2)) * PEDAL_FRAMES;
	const draw = (f: Ctx) =>
		drawCyclist(f, rider ?? null, 'side', stroke, AT_X, BIKE_GROUND, {
			talking: !!rider?.speaking && !s.still && Math.floor(s.t * 6) % 2 === 0,
		});
	if (rider?.faded)
		faded(g, AT_X, BIKE_GROUND - 18, (f, x, base) => {
			f.save();
			f.translate(x - AT_X, base - BIKE_GROUND + 18);
			draw(f);
			f.restore();
		});
	else draw(g);
	g.restore();
	if (!rider) return;
	// Words and marks are never turned: placed by hand on the turned side.
	const turn = (x: number, w: number) =>
		(b.face > 0 ? AT_X * 2 + 1 - x - w : x) + dx;
	if (rider.speaking) bubble(g, turn(AT_X - 12, 8), 76 + dy, s);
	if (rider.sounding)
		sprite(
			g,
			NOTE,
			turn(AT_X - 22, 3),
			(rider.speaking ? 72 : 80) + dy,
			C.lilac,
		);
	if (rider.watts <= 0) return;
	const label = `${Math.round(rider.watts)} W`;
	const x = turn(AT_X - 8, 1) - Math.round(textWidth(label) / 2);
	const y = (rider.speaking ? 68 : 78) + dy;
	g.globalAlpha = 0.35;
	for (const [ox, oy] of [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	])
		text(g, label, x + ox, y + oy, C.watt);
	g.globalAlpha = 1;
	text(g, label, x, y, C.watt);
}

export function drawHearts(g: Ctx, s: SceneInput) {
	for (const h of s.hearts) {
		const age = s.t - h.born;
		if (age > 1.8) continue;
		const rise = s.still ? 0 : age;
		const x = h.x + Math.round(Math.sin(rise * 5) * 1.5);
		inkedSprite(g, HEART, x, Math.round(h.y - rise * 14), C.heart, C.ink);
	}
}
