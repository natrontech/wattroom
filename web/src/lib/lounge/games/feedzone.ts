/**
 * Feed zone: thirty seconds past the soigneurs at the roadside, on one
 * button. Press to reach out and grab what they hold up: a bidon, or a
 * musette worth more and harder to catch. Every grab in a row is worth more;
 * a soigneur passed by, a grab at thin air, or a fan's flag snatched by
 * mistake breaks the streak. The road gets faster, and the day's seed sets
 * who stands where.
 */
import { hash3 } from '$lib/lounge/hash';
import { LOUNGE as C, SKIES } from '$lib/lounge/palette';
import { disc, rect, ring, text, textWidth, type Ctx } from '$lib/lounge/pixel';
import { SCREEN_W as W, type Game, type Sound } from './game';

export const RUN_SEC = 30;
/** Metres a second at the start and at the end. */
const SPEED_FROM = 8;
const SPEED_TO = 15;
/** How long an arm stays out, and before it can reach again. */
export const REACH_SEC = 0.28;
const COOLDOWN_SEC = 0.42;
/** Points for each thing, and the most a streak multiplies them by. */
export const POINTS = { bidon: 50, musette: 120 } as const;
export const MAX_MULT = 4;
/** How close a hand must pass, in metres, for each thing. */
const REACH_M = { bidon: 1.3, musette: 0.8, flag: 1.3 } as const;
/** The rider's hand, in metres ahead of where the screen's rider stands. */
const HAND_M = 0;
/** Metres a pixel of road is worth, and where the rider stands on screen. */
const PX_PER_M = 4;
const RIDER_X = 44;

export type Held = 'bidon' | 'musette' | 'flag';

export interface Stand {
	/** Metres along the road. */
	at: number;
	holds: Held;
	/** Grabbed, missed, or still ahead. */
	done?: 'got' | 'missed' | 'flag';
}

export interface Run {
	t: number;
	metres: number;
	stands: Stand[];
	/** Seconds the arm has left out, and before it can reach again. */
	reach: number;
	cool: number;
	wasHeld: boolean;
	streak: number;
	best: number;
	points: number;
	/** What happened this step, for the cabinet's sound. */
	last?: Sound;
}

const speedAt = (t: number) =>
	SPEED_FROM + (SPEED_TO - SPEED_FROM) * Math.min(1, t / RUN_SEC);

/** Everyone at the roadside on a day: 12 to 30 m apart, one in five a fan. */
export function standsOf(seed: number): Stand[] {
	const out: Stand[] = [];
	let at = 30;
	for (let i = 0; at < 420; i++) {
		const r = hash3(seed, i, 7);
		const holds: Held = r < 0.2 ? 'flag' : r < 0.45 ? 'musette' : 'bidon';
		out.push({ at, holds });
		at += 12 + Math.floor(hash3(seed, i, 11) * 18);
	}
	return out;
}

export const newRun = (seed = 0): Run => ({
	t: 0,
	metres: 0,
	stands: standsOf(seed),
	reach: 0,
	cool: 0,
	wasHeld: false,
	streak: 0,
	best: 0,
	points: 0,
});

export const over = (r: Run): boolean => r.t >= RUN_SEC;
export const scoreOf = (r: Run): number => r.points;
export const multOf = (streak: number): number =>
	Math.min(MAX_MULT, 1 + Math.floor(streak / 3));

export function step(r: Run, dt: number, held: boolean): Run {
	if (over(r)) return r;
	const next: Run = {
		...r,
		t: Math.min(RUN_SEC, r.t + dt),
		metres: r.metres + speedAt(r.t) * dt,
		reach: Math.max(0, r.reach - dt),
		cool: Math.max(0, r.cool - dt),
		wasHeld: held,
		stands: r.stands,
		last: undefined,
	};
	const pressed = held && !r.wasHeld;
	if (pressed && next.cool === 0) {
		next.reach = REACH_SEC;
		next.cool = COOLDOWN_SEC;
	}
	const hand = next.metres + HAND_M;
	let changed = false;
	let grabbed = false;
	const stands = r.stands.map((s) => {
		if (s.done) return s;
		const near = Math.abs(s.at - hand) <= REACH_M[s.holds];
		if (next.reach > 0 && near) {
			changed = true;
			grabbed = true;
			next.reach = 0;
			if (s.holds === 'flag') {
				next.streak = 0;
				next.last = 'miss';
				return { ...s, done: 'flag' as const };
			}
			next.streak += 1;
			next.best = Math.max(next.best, next.streak);
			next.points += POINTS[s.holds] * multOf(next.streak - 1);
			next.last = 'grab';
			return { ...s, done: 'got' as const };
		}
		if (s.at < hand - REACH_M[s.holds]) {
			changed = true;
			if (s.holds === 'flag') return { ...s, done: 'missed' as const };
			next.streak = 0;
			next.last ??= 'miss';
			return { ...s, done: 'missed' as const };
		}
		return s;
	});
	// A reach that ran out on nobody is a grab at thin air.
	if (r.reach > 0 && next.reach === 0 && !grabbed) {
		next.streak = 0;
		next.last = 'miss';
	}
	if (changed) next.stands = stands;
	return next;
}

const screenX = (r: Run, at: number) =>
	Math.round(RIDER_X + (at - r.metres) * PX_PER_M);

/** A soigneur or a fan at the roadside, holding their thing up. */
function person(g: Ctx, x: number, s: Stand, t: number) {
	const y = 58;
	const coat = s.holds === 'flag' ? C.violet : C.teal;
	rect(g, x - 2, y, 5, 8, coat);
	rect(g, x - 2, y + 8, 2, 5, C.pants);
	rect(g, x + 1, y + 8, 2, 5, C.pants);
	disc(g, x, y - 3, 2, C.heart);
	rect(g, x - 2, y - 6, 5, 2, s.holds === 'flag' ? C.amber : C.ink);
	if (s.done === 'got') return;
	// The arm held out over the road, and what it holds.
	rect(g, x + 3, y + 1, 3, 1, C.heart);
	if (s.holds === 'bidon') {
		rect(g, x + 5, y - 3, 3, 5, C.tealLight);
		rect(g, x + 5, y - 4, 3, 1, C.ink);
	} else if (s.holds === 'musette') {
		rect(g, x + 5, y - 5, 1, 6, C.paper);
		rect(g, x + 4, y + 1, 5, 5, C.paper);
		rect(g, x + 5, y + 2, 3, 1, C.red);
	} else {
		const wave = Math.floor(t * 6) % 2;
		rect(g, x + 5, y - 8, 1, 9, C.woodLight);
		rect(g, x + 6, y - 8 + wave, 5, 4, C.red);
		rect(g, x + 7, y - 7 + wave, 3, 2, C.paper);
	}
}

function draw(g: Ctx, r: Run) {
	// A summer day in five bands, two clouds drifting, a far line of trees,
	// then the field, the crowd barrier, the road and its line.
	SKIES.day.forEach((c, i) => rect(g, 0, i * 8, W, 8, c));
	for (const [at, y, w] of [
		[30, 8, 18],
		[110, 14, 24],
	] as const) {
		const x =
			(Math.round(((at - r.metres * 0.6) % (W + 40)) + W + 40) % (W + 40)) - 30;
		rect(g, x + 3, y, w - 6, 2, C.paper);
		rect(g, x, y + 2, w, 3, C.paper);
		rect(g, x + 1, y + 5, w - 2, 1, C.lilac);
	}
	const far = Math.round(r.metres * 1.2);
	for (let x = 0; x < W; x++) {
		const h =
			6 +
			Math.round(3 * Math.sin((x + far) / 7) + 2 * Math.sin((x + far) / 2.7));
		rect(g, x, 46 - h, 1, h, C.leafDark);
	}
	rect(g, 0, 46, W, 24, C.leaf);
	const rows = Math.round(r.metres * 2) % 12;
	for (let x = -rows; x < W; x += 12) rect(g, x, 50, 6, 1, C.leafLight);
	rect(g, 0, 70, W, 20, C.slate);
	rect(g, 0, 70, W, 1, C.lilac);
	const dash = Math.round(r.metres * PX_PER_M) % 16;
	for (let x = -dash; x < W; x += 16) rect(g, x, 80, 8, 1, C.paper);
	for (const s of r.stands) {
		const x = screenX(r, s.at);
		if (x > -12 && x < W + 12) person(g, x, s, r.t);
	}
	// The rider, an arm out while reaching.
	const y = 82;
	const spin = Math.floor(r.metres * 2) % 2;
	ring(g, RIDER_X - 6, y - 4, 4, C.ink);
	ring(g, RIDER_X + 6, y - 4, 4, C.ink);
	rect(g, RIDER_X - 6 + spin, y - 4, 1, 1, C.paper);
	rect(g, RIDER_X + 6 - spin, y - 4, 1, 1, C.paper);
	rect(g, RIDER_X - 6, y - 8, 12, 1, C.teal);
	rect(g, RIDER_X - 2, y - 15, 6, 7, C.heart);
	rect(g, RIDER_X - 2, y - 15, 6, 2, C.red);
	disc(g, RIDER_X + 2, y - 18, 2, C.heart);
	rect(g, RIDER_X, y - 21, 5, 2, C.amber);
	rect(g, RIDER_X + 3, y - 18, 1, 1, C.ink);
	if (r.reach > 0) rect(g, RIDER_X + 4, y - 22, 1, 8, C.heart);
	else rect(g, RIDER_X + 4, y - 13, 4, 1, C.heart);
	const score = String(r.points);
	text(g, score, W - textWidth(score) - 3, 3, C.amber);
	text(g, String(Math.ceil(RUN_SEC - r.t)), 3, 3, C.paper);
	if (r.streak >= 3) {
		const mult = `X${multOf(r.streak)}`;
		text(g, mult, Math.round((W - textWidth(mult)) / 2), 3, C.teal);
	}
}

export const FEED_ZONE: Game<Run> = {
	id: 'feedzone',
	name: 'Feed zone',
	how: 'Thirty seconds past the soigneurs. Tap to grab a bidon or a musette as you pass, and leave the flags alone.',
	most: 9999,
	button: 'Tap to grab',
	start: newRun,
	step,
	over,
	score: scoreOf,
	sound: (_before, after) => after.last,
	draw,
};
