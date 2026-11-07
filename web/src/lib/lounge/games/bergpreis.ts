/**
 * Bergpreis, thirty seconds up a hill on one button. Hold to push and the
 * needle rises, let go and it falls. The band drifts as the road changes,
 * and you climb fast only while the needle is inside it; stay in and you
 * climb faster still. The day's seed sets how the road changes.
 */
import { hash3 } from '$lib/lounge/hash';
import { LOUNGE as C, SKIES, SUNS } from '$lib/lounge/palette';
import { disc, rect, ring, text, textWidth, type Ctx } from '$lib/lounge/pixel';
import { SCREEN_H as H, SCREEN_W as W, type Game } from './game';

export const RUN_SEC = 30;
/** The band's width, of a meter that runs 0 to 1. */
export const BAND = 0.26;
const RISE = 1.4;
const FALL = 0.9;
/** Metres a second out of the band, in it, and the most a streak adds. */
const CRAWL = 2;
const CLIMB = 10;
const STREAK = 10;
/** Seconds in the band for the whole of that. */
const STREAK_SEC = 5;

export interface Run {
	t: number;
	power: number;
	metres: number;
	/** Seconds in the band without leaving it. */
	streak: number;
	seed: number;
}

export const newRun = (seed = 0): Run => ({
	t: 0,
	power: 0.3,
	metres: 0,
	streak: 0,
	seed,
});

/** Where the band's middle is at a moment: two slow waves, the road's grade. */
export const bandAt = (t: number, seed = 0): number => {
	const a = seed ? hash3(seed, 1, 0) * 6.283 : 0;
	const b = seed ? hash3(seed, 2, 0) * 6.283 : 1;
	return 0.5 + 0.28 * Math.sin(t * 0.8 + a) + 0.1 * Math.sin(t * 2.1 + b);
};

export const inBand = (r: Run): boolean =>
	Math.abs(r.power - bandAt(r.t, r.seed)) <= BAND / 2;

export const over = (r: Run): boolean => r.t >= RUN_SEC;

/** The score a run ends on: ten for every metre. */
export const scoreOf = (r: Run): number => Math.floor(r.metres * 10);

/** One step of `dt` seconds, with the button held or not. */
export function step(r: Run, dt: number, held: boolean): Run {
	if (over(r)) return r;
	const power = Math.min(1, Math.max(0, r.power + (held ? RISE : -FALL) * dt));
	const next = { ...r, t: Math.min(RUN_SEC, r.t + dt), power };
	const hit = inBand(next);
	next.streak = hit ? r.streak + dt : 0;
	const speed = hit
		? CLIMB + STREAK * Math.min(1, next.streak / STREAK_SEC)
		: CRAWL;
	next.metres = r.metres + speed * dt;
	return next;
}

/** The road's height at a screen column: it climbs to the right. */
const roadY = (x: number) => 76 - Math.round((x - 18) * 0.2);

function draw(g: Ctx, run: Run) {
	// A dusk sky in its five bands, the sun low, and two ranges that scroll
	// slower the farther off they are.
	SKIES.dusk.forEach((c, i) => rect(g, 0, i * 9, W, 9, c));
	const [sunTop, sunLow] = SUNS.dusk;
	disc(g, 118, 38, 9, sunLow);
	disc(g, 118, 36, 8, sunTop);
	const ridge = (
		speed: number,
		base: number,
		tall: number,
		c: string,
		cap?: string,
	) => {
		const off = run.metres * speed;
		for (let x = 0; x < W; x++) {
			const h = Math.round(
				tall +
					(tall / 2) * Math.sin((x + off) / 13) +
					(tall / 4) * Math.sin((x + off) / 4.7),
			);
			rect(g, x, base - h, 1, H - base + h, c);
			if (cap && h > tall * 1.3) rect(g, x, base - h, 1, 1, cap);
		}
	};
	ridge(0.15, 46, 10, C.mountain, C.snow);
	ridge(0.5, 58, 6, C.wallDark);
	// The hill: grass under a road, posts and the summit's banner going by.
	const scroll = run.metres * 2;
	for (let x = 18; x < W; x++) {
		const y = roadY(x);
		rect(g, x, y, 1, H - y, C.leafDark);
		rect(g, x, y, 1, 2, C.slate);
		rect(g, x, y, 1, 1, C.lilac);
	}
	for (let i = 0; i < 4; i++) {
		const x = Math.round(150 - ((scroll + i * 40) % 132));
		const y = roadY(x);
		rect(g, x, y - 7, 1, 7, C.paper);
		rect(g, x, y - 7, 1, 2, C.red);
	}
	// The rider: two wheels, a frame, someone on it, legs turning.
	const rx = 56;
	const ry = roadY(rx) - 1;
	const turn = Math.floor(run.metres * 1.5) % 4;
	ring(g, rx - 5, ry - 3, 3, C.ink);
	ring(g, rx + 5, ry - 5, 3, C.ink);
	rect(g, rx - 5, ry - 6, 10, 1, C.teal);
	rect(g, rx - 1, ry - 13, 5, 6, C.heart);
	rect(g, rx - 1, ry - 13, 5, 2, C.red);
	disc(g, rx + 3, ry - 16, 2, C.heart);
	rect(g, rx + 1, ry - 19, 5, 2, C.amber);
	rect(g, rx + 4, ry - 16, 1, 1, C.ink);
	const knee = [0, 1, 0, -1][turn];
	rect(g, rx, ry - 7 + knee, 2, 3, C.pants);
	// The meter: the band drifting, the needle held up by the button.
	rect(g, 4, 6, 8, 78, C.ink);
	const y = (v: number) => 83 - Math.round(v * 76);
	const mid = bandAt(run.t, run.seed);
	const hit = inBand(run);
	rect(
		g,
		5,
		y(mid + BAND / 2),
		6,
		Math.round(BAND * 76),
		hit ? C.teal : C.leaf,
	);
	rect(g, 3, y(run.power), 10, 2, C.paper);
	if (run.streak >= STREAK_SEC) rect(g, 3, 4, 10, 1, C.amber);
	const score = String(scoreOf(run));
	text(g, score, W - textWidth(score) - 3, 3, C.amber);
	text(g, String(Math.ceil(RUN_SEC - run.t)), 18, 3, C.paper);
}

export const BERGPREIS: Game<Run> = {
	id: 'bergpreis',
	name: 'Bergpreis',
	how: 'Thirty seconds up the hill. Hold to push, let go to ease off, and keep the needle in the band.',
	most: 9999,
	button: 'Hold to push',
	start: newRun,
	step,
	over,
	score: scoreOf,
	sound: () => undefined,
	draw,
};
