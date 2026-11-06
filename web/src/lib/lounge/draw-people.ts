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
import { LOUNGE as C, shadeOf } from '$lib/lounge/palette';
import {
	disc,
	ellipse,
	inkedSprite,
	limb,
	outlined,
	rect,
	ring,
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
	type Bike,
	type Figure,
	type Rider,
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

/**
 * Hair by style, over a head whose left edge is hx and top row ht, and the
 * cap over it. Under a cap a bun or a mohawk is cut to short hair.
 */
function hair(f: Figure, hx: number, ht: number): Part[] {
	const h = f.hair;
	const style =
		f.cap && (f.hairStyle === 2 || f.hairStyle === 4) ? 0 : f.hairStyle;
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
		const wave = waving(s, n);
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
			// A tee's sleeves end at the elbow.
			if (f.top === 0) {
				rect(g, x - 4, base - 6, 1, 2, f.skin);
				rect(g, x + 3, base - 6, 1, 2, f.skin);
			}
			rect(g, x - 5, base - 4, 2, 1, f.skin);
			rect(g, x + 3, base - 4, 2, 1, f.skin);
		} else {
			rect(g, x - 8, base - 19, 2, 2, f.skin);
			rect(g, x + 6, base - 19, 2, 2, f.skin);
		}
		if (pose === 'sofa') {
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
		const shut = blinking(s, n);
		rect(g, hx + 2, shut ? ey + 1 : ey, 1, shut ? 1 : 2, C.ink);
		rect(g, hx + 7, shut ? ey + 1 : ey, 1, shut ? 1 : 2, C.ink);
		const open = f.speaking && !s.still && Math.floor(s.t * 6 + n) % 2 === 0;
		rect(g, hx + 4, ht + 7, 2, open ? 2 : 1, open ? C.ink : f.skinShade);
		specs(g, f, hx, ey);
		if (f.muted) {
			rect(g, hx - 1, ht - 2, 12, 1, C.cable);
			rect(g, hx - 2, ht - 1, 1, 4, C.cable);
			rect(g, hx + 11, ht - 1, 1, 4, C.cable);
		}
	};
	if (f.faded) faded(g, x, base, draw);
	else draw(g, x, base);
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
function stripeOn(shirt: string): string {
	const n = parseInt(shirt.slice(1), 16);
	const light = 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
	return light > 150 ? C.ink : C.paper;
}

/** What tells the tops apart: a hoodie's strings and pocket, a jersey's zip, a sweater's neck and hem. */
function topMarks(g: Ctx, f: Figure, x: number, base: number) {
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
	}
}

/** Round frames over the eyes, or dark lenses on them, eye row ey. */
function specs(g: Ctx, f: Figure, hx: number, ey: number) {
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
const AT_X = 263;
const FRONT = [251, 128];
const REAR = [275, 128];
const BB = [263, 130];
const SADDLE = [268, 118];
const BARS = [255, 117];

/**
 * A bike on its trainer, facing the rug: a chunky sprite at the people's
 * own scale, two-pixel tubes and wheels, its rider built like everyone on
 * the sofa. Unridden, a towel hangs over the bars.
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
	ellipse(g, AT_X, BIKE_GROUND + 1, 18, 1, C.floorDark);
	outlined(
		g,
		[
			[270, BIKE_GROUND - 2, 10, 2, C.cable],
			[246, BIKE_GROUND - 1, 10, 1, C.cable],
		],
		C.ink,
	);
	for (const [cx, cy] of [FRONT, REAR]) {
		disc(g, cx, cy, 7, C.ink);
		disc(g, cx, cy, 5, C.floor);
		ring(g, cx, cy, 5, C.lilac);
		rect(g, cx - 1, cy - 1, 2, 2, C.lilac);
	}
	for (const [a, c] of [
		[REAR, BB],
		[REAR, SADDLE],
		[SADDLE, BB],
		[BB, BARS],
		[SADDLE, BARS],
		[BARS, FRONT],
	])
		limb(g, a, c, 2, C.violet, C.ink);
	outlined(
		g,
		[
			[265, 116, 7, 2, C.cable],
			[251, 115, 5, 2, C.cable],
		],
		C.ink,
	);
	const angle = rider?.crank ?? 0.9;
	const p1 = [BB[0] - Math.cos(angle) * 4, BB[1] + Math.sin(angle) * 4];
	const p2 = [BB[0] + Math.cos(angle) * 4, BB[1] - Math.sin(angle) * 4];
	if (!rider) {
		limb(g, BB, p1, 1, C.lilac, C.ink);
		limb(g, BB, p2, 1, C.lilac, C.ink);
		outlined(g, [[252, 117, 3, 6, C.towel]], C.ink);
	} else if (rider.faded)
		faded(g, 262, 116, (f, x, base) => {
			f.save();
			f.translate(x - 262, base - 116);
			onTheBike(f, s, rider, p1, p2);
			f.restore();
		});
	else onTheBike(g, s, rider, p1, p2);
	g.restore();
	if (!rider) return;
	// Words and marks are never turned: placed by hand on the turned side.
	const turn = (x: number, w: number) =>
		(b.face > 0 ? AT_X * 2 + 1 - x - w : x) + dx;
	if (rider.speaking) bubble(g, turn(266, 8), 88 + dy, s);
	if (rider.sounding)
		sprite(g, NOTE, turn(254, 3), (rider.speaking ? 84 : 92) + dy, C.lilac);
	if (rider.watts <= 0) return;
	const label = `${Math.round(rider.watts)} W`;
	const x = turn(262, 1) - Math.round(textWidth(label) / 2);
	const y = (rider.speaking ? 80 : 90) + dy;
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

/** The rider: legs to the pedals, the knee toward the bars, a sitter's head and body. */
function onTheBike(
	g: Ctx,
	s: SceneInput,
	r: Rider,
	p1: number[],
	p2: number[],
) {
	const hip = [267, 116];
	const leg = (pedal: number[], colour: string) => {
		const thigh = 7;
		const shin = 8;
		const dx = pedal[0] - hip[0];
		const dy = pedal[1] - hip[1];
		const d = Math.min(thigh + shin - 0.01, Math.hypot(dx, dy));
		const bend = Math.acos(
			(thigh * thigh + d * d - shin * shin) / (2 * thigh * d),
		);
		const toward = Math.atan2(dy, dx);
		const knee = [
			hip[0] + Math.cos(toward + bend) * thigh,
			hip[1] + Math.sin(toward + bend) * thigh,
		];
		limb(g, hip, knee, 3, colour, C.ink);
		limb(g, knee, pedal, 2, colour, C.ink);
		limb(g, BB, pedal, 1, C.lilac, C.ink);
	};
	leg(p2, r.pantsShade);
	// Body, leaning to the bars, and the arm reaching them.
	const hx = 255;
	const ht = 97;
	const parts: Part[] = [
		[259, 106, 10, 9, r.shirt],
		[hx, ht, 10, 9, r.skin],
		[252, 110, 7, 2, r.shirt],
		...hair(r, hx, ht),
		...(r.scarf ? ([[258, 105, 8, 2, r.scarf]] as Part[]) : []),
	];
	if (r.muted)
		parts.push(
			[hx - 2, ht + 3, 2, 4, C.lilac],
			[hx + 10, ht + 3, 2, 4, C.lilac],
		);
	outlined(g, parts, C.ink);
	rect(g, 266, 106, 3, 9, r.shirtShade);
	rect(g, 252, 112, 3, 2, r.skin);
	rect(g, hx + 9, ht + 3, 1, 6, r.skinShade);
	rect(g, hx + 1, ht + 8, 8, 1, r.skinShade);
	rect(g, hx + 2, ht + 5, 1, 2, C.ink);
	rect(g, hx + 7, ht + 5, 1, 2, C.ink);
	const open = r.speaking && !s.still && Math.floor(s.t * 6) % 2 === 0;
	rect(g, hx + 4, ht + 7, 2, open ? 2 : 1, open ? C.ink : r.skinShade);
	specs(g, r, hx, ht + 5);
	if (r.muted) {
		rect(g, hx - 1, ht - 2, 12, 1, C.cable);
		rect(g, hx - 2, ht - 1, 1, 4, C.cable);
		rect(g, hx + 11, ht - 1, 1, 4, C.cable);
	}
	leg(p1, r.pants);
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
