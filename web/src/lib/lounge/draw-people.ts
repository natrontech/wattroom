/**
 * Who is in the voice channel: on the sofa, on the bike when they ride, and
 * on cushions along the front once the sofa is full. What can be told from
 * across the room is drawn here: a speech bubble over whoever talks, an away
 * rider's seat holding what they went for, a fading figure whose link
 * dropped. Their names and the quieter marks hang under them in the page
 * (LoungeScene). The watts above the bike are the picture's one live number,
 * in the theme's watt hue (ADR-0005).
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import {
	dot,
	line,
	rect,
	ring,
	sprite,
	text,
	textWidth,
	type Ctx,
} from '$lib/lounge/pixel';
import {
	FLOOR_BASE,
	SEAT_STEP,
	SEAT_X0,
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

export function drawPeople(g: Ctx, s: SceneInput) {
	sofa(g, s);
	bike(g, s);
}

/** Ink-edged, so it reads on the cave's wall and on paper's alike. */
function bubble(g: Ctx, x: number, y: number, s: SceneInput) {
	for (const [dx, dy] of [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	])
		sprite(g, BUBBLE, x + dx, y + dy, C.ink);
	sprite(g, BUBBLE, x, y, C.paper);
	const dots = s.still ? 3 : 1 + (Math.floor(s.t * 4) % 3);
	for (let i = 0; i < dots; i++) dot(g, x + 2 + i * 2, y + 2, C.ink);
}

/** Whether seat n has its arms up: the wave runs along the crew in order. */
function waving(s: SceneInput, n: number): boolean {
	const into = s.t - s.waveAt - n * 0.18;
	return !s.still && into >= 0 && into < 0.6;
}

/** Someone sitting, their seat's left edge at x and its top row at base. */
function sitter(
	g: Ctx,
	s: SceneInput,
	f: Figure,
	x: number,
	base: number,
	n: number,
) {
	if (f.faded) g.globalAlpha = 0.45;
	rect(g, x + 1, base - 10, 9, 10, f.shirt);
	rect(g, x + 2, base - 11, 7, 1, f.shirt);
	rect(g, x + 4, base - 12, 3, 1, f.skin);
	rect(g, x + 3, base - 18, 5, 6, f.skin);
	rect(g, x + 3, base - 19, 5, 2, f.hair);
	rect(g, x + 2, base - 18, 1, 3, f.hair);
	dot(g, x + 4, base - 15, C.ink);
	dot(g, x + 6, base - 15, C.ink);
	if (waving(s, n)) {
		rect(g, x, base - 17, 1, 7, f.skin);
		rect(g, x + 10, base - 17, 1, 7, f.skin);
	}
	g.globalAlpha = 1;
	if (f.speaking) bubble(g, x + 9, base - 27, s);
	if (f.sounding)
		sprite(g, NOTE, f.speaking ? x - 3 : x + 9, base - 23, C.lilac);
}

function leftBehind(g: Ctx, f: Figure, x: number, base: number) {
	const thing = LEFT_BEHIND[f.away ?? ''] ?? LEFT_BEHIND[''];
	sprite(g, thing.rows, x + 3, base - thing.rows.length, C[thing.colour]);
}

function sofa(g: Ctx, s: SceneInput) {
	rect(g, 38, 138, 96, 10, C.wood);
	rect(g, 34, 140, 6, 18, C.wood);
	rect(g, 132, 140, 6, 18, C.wood);
	s.crew.seated.forEach((f, i) => {
		if (f.away === undefined) sitter(g, s, f, SEAT_X0 + i * SEAT_STEP, 148, i);
	});
	rect(g, 36, 148, 100, 8, C.woodLight);
	rect(g, 36, 148, 100, 1, C.cushion);
	rect(g, 38, 156, 3, 4, C.ink);
	rect(g, 131, 156, 3, 4, C.ink);
	s.crew.seated.forEach((f, i) => {
		const x = SEAT_X0 + i * SEAT_STEP;
		if (f.away === undefined) rect(g, x, 146, 11, 2, C.laptop);
		else leftBehind(g, f, x, 148);
	});
}

/** The cushions along the front, in room pixels: anyone past the sofa. */
export function drawFloor(g: Ctx, s: SceneInput, oy: number) {
	const base = oy + FLOOR_BASE;
	s.crew.floor.forEach(({ f, x }, i) => {
		rect(g, x - 8, base, 17, 4, C.cushion);
		rect(g, x - 8, base, 17, 1, C.lilac);
		if (f.away !== undefined) return leftBehind(g, f, x - 5, base);
		sitter(g, s, f, x - 5, base, s.crew.seated.length + i);
		rect(g, x - 6, base - 3, 13, 3, C.legNear);
	});
	if (!s.crew.more) return;
	const last = Math.max(...s.crew.floor.map((c) => c.x));
	text(g, `+${s.crew.more}`, last + 12, base - 9, C.lilac);
}

function bike(g: Ctx, s: SceneInput) {
	rect(g, 158, 158, 20, 6, C.trim);
	rect(g, 154, 163, 28, 2, C.trim);
	rect(g, 200, 160, 12, 4, C.trim);
	const rear = [168, 150];
	const front = [206, 150];
	const bb = [186, 152];
	const seat = [180, 132];
	const head = [200, 134];
	ring(g, rear[0], rear[1], 10, C.lilac);
	ring(g, front[0], front[1], 10, C.lilac);
	for (const [a, b] of [
		[rear, bb],
		[rear, seat],
		[seat, bb],
		[seat, head],
		[head, bb],
		[head, front],
	])
		line(g, a[0], a[1], b[0], b[1], C.violet);
	rect(g, 176, 130, 8, 2, C.ink);
	line(g, 200, 134, 204, 130, C.violet);
	rect(g, 203, 129, 5, 2, C.ink);
	const rider = s.crew.rider;
	const angle = rider?.crank ?? 0.9;
	const p1 = [bb[0] + Math.cos(angle) * 6, bb[1] + Math.sin(angle) * 6];
	const p2 = [bb[0] - Math.cos(angle) * 6, bb[1] - Math.sin(angle) * 6];
	line(g, bb[0], bb[1], p1[0], p1[1], C.lilac);
	line(g, bb[0], bb[1], p2[0], p2[1], C.lilac);
	if (!rider) {
		rect(g, 201, 131, 4, 7, C.towel);
		return;
	}
	onTheBike(g, s, rider, p1, p2);
}

/** Two-bone legs from the hip to each pedal, the knee always forward. */
function onTheBike(
	g: Ctx,
	s: SceneInput,
	r: Rider,
	p1: number[],
	p2: number[],
) {
	const hip = [181, 128];
	const shoulder = [193, 117];
	const leg = (pedal: number[], colour: string) => {
		const thigh = 11;
		const shin = 12;
		const dx = pedal[0] - hip[0];
		const dy = pedal[1] - hip[1];
		const d = Math.min(thigh + shin - 0.01, Math.hypot(dx, dy));
		const bend = Math.acos(
			(thigh * thigh + d * d - shin * shin) / (2 * thigh * d),
		);
		const toward = Math.atan2(dy, dx);
		const knee = [
			hip[0] + Math.cos(toward - bend) * thigh,
			hip[1] + Math.sin(toward - bend) * thigh,
		];
		line(g, hip[0], hip[1], knee[0], knee[1], colour);
		line(g, hip[0] + 1, hip[1], knee[0] + 1, knee[1], colour);
		line(g, knee[0], knee[1], pedal[0], pedal[1], colour);
	};
	if (r.faded) g.globalAlpha = 0.45;
	leg(p2, C.legFar);
	for (let o = -1; o <= 1; o++)
		line(g, hip[0], hip[1] + o, shoulder[0], shoulder[1] + o, r.shirt);
	line(g, shoulder[0], shoulder[1], 204, 129, r.skin);
	leg(p1, C.legNear);
	rect(g, 195, 110, 5, 5, r.skin);
	rect(g, 195, 109, 5, 2, r.hair);
	g.globalAlpha = 1;
	if (r.speaking) bubble(g, 202, 100, s);
	if (r.sounding) sprite(g, NOTE, 202, r.speaking ? 92 : 104, C.lilac);
	if (r.watts <= 0) return;
	const label = `${Math.round(r.watts)} W`;
	const x = 190 - Math.round(textWidth(label) / 2);
	g.globalAlpha = 0.35;
	for (const [ox, oy] of [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	])
		text(g, label, x + ox, 99 + oy, C.watt);
	g.globalAlpha = 1;
	text(g, label, x, 99, C.watt);
}

export function drawHearts(g: Ctx, s: SceneInput) {
	for (const h of s.hearts) {
		const age = s.t - h.born;
		if (age > 1.8) continue;
		const rise = s.still ? 0 : age;
		const x = h.x + Math.round(Math.sin(rise * 5) * 1.5);
		sprite(g, HEART, x, Math.round(h.y - rise * 14), C.heart);
	}
}
