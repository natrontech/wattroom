/**
 * Darts at the corkboard: three darts on one button. The aim sways; hold the
 * button to steady it and let go to throw, but hold too long and the hand
 * starts to shake. A dart scores where it lands: the number of its segment,
 * twice that on the outer ring, three times on the inner one, 25 and 50 for
 * the bull. The day's seed sets how the aim sways and the draught across
 * the room.
 */
import { hash3 } from '$lib/lounge/hash';
import { LOUNGE as C } from '$lib/lounge/palette';
import { outlined, rect, text, textWidth, type Ctx } from '$lib/lounge/pixel';
import { SCREEN_H as H, SCREEN_W as W, type Game, type Sound } from './game';

export const DARTS = 3;
/** The board's middle and its rings' radii, in screen pixels. */
export const CX = 80;
export const CY = 46;
const BULL = 2;
const OUTER_BULL = 4;
const TREBLE = [18, 20] as const;
const DOUBLE = [31, 33] as const;
/** The numbers round the board, clockwise from the top. */
const ORDER = [
	20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];
/** How far the aim sways, how much holding steadies it, and when the hand shakes. */
const SWAY = 24;
const STEADY = 0.75;
const STEADY_SEC = 0.9;
const SHAKE_SEC = 1.8;
/** A dart throws itself after this long, and the next comes after this pause. */
const DART_SEC = 7;
const PAUSE_SEC = 0.9;

export interface Dart {
	x: number;
	y: number;
	points: number;
}

export interface Run {
	t: number;
	/** Seconds since this dart came up, and the button held for. */
	since: number;
	holding: number;
	wasHeld: boolean;
	darts: Dart[];
	seed: number;
	last?: Sound;
}

export const newRun = (seed = 0): Run => ({
	t: 0,
	since: 0,
	holding: 0,
	wasHeld: false,
	darts: [],
	seed,
});

/** What a dart is worth landing at a pixel. */
export function pointsAt(x: number, y: number): number {
	const dx = x - CX;
	const dy = y - CY;
	const r = Math.hypot(dx, dy);
	if (r <= BULL) return 50;
	if (r <= OUTER_BULL) return 25;
	if (r > DOUBLE[1]) return 0;
	// Clockwise from straight up, each segment centred on its number.
	const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1 + 1 / 40) % 1;
	const n = ORDER[Math.floor(turn * 20)];
	if (r >= DOUBLE[0]) return n * 2;
	if (r >= TREBLE[0] && r <= TREBLE[1]) return n * 3;
	return n;
}

/** Where the aim is: a slow sway, steadied while held, shaking held too long. */
export function aimOf(r: Run): { x: number; y: number } {
	const f1 = 1.1 + hash3(r.seed, 3, 1) * 0.9;
	const f2 = 1.7 + hash3(r.seed, 3, 2) * 1.1;
	const p1 = hash3(r.seed, 3, 3) * 6.283;
	const p2 = hash3(r.seed, 3, 4) * 6.283;
	const draught = (hash3(r.seed, 3, 5) - 0.5) * 6;
	const steady = 1 - STEADY * Math.min(1, r.holding / STEADY_SEC);
	const shake = Math.max(0, r.holding - SHAKE_SEC) * 14;
	const t = r.t;
	return {
		x:
			CX +
			draught +
			SWAY * steady * Math.sin(t * f1 + p1) +
			shake * Math.sin(t * 31),
		y:
			CY +
			SWAY * 0.8 * steady * Math.sin(t * f2 + p2) +
			shake * Math.sin(t * 27 + 1),
	};
}

const throwing = (r: Run) => r.darts.length < DARTS;
export const over = (r: Run): boolean =>
	r.darts.length === DARTS && r.since >= PAUSE_SEC;
export const scoreOf = (r: Run): number =>
	r.darts.reduce((sum, d) => sum + d.points, 0);

export function step(r: Run, dt: number, held: boolean): Run {
	if (over(r)) return r;
	const next: Run = {
		...r,
		t: r.t + dt,
		since: r.since + dt,
		wasHeld: held,
		last: undefined,
	};
	if (!throwing(r)) return next;
	// The pause after a dart: the next one waits for the button to come up.
	const ready = r.darts.length === 0 || r.since >= PAUSE_SEC;
	if (!ready) return next;
	next.holding = held ? r.holding + dt : 0;
	const released = !held && r.holding > 0;
	if (released || next.since >= DART_SEC + (r.darts.length ? PAUSE_SEC : 0)) {
		const aim = aimOf(r);
		const x = Math.round(aim.x);
		const y = Math.round(aim.y);
		const points = pointsAt(x, y);
		next.darts = [...r.darts, { x, y, points }];
		next.since = 0;
		next.holding = 0;
		next.last = points === 50 ? 'bull' : points > 0 ? 'hit' : 'miss';
	}
	return next;
}

/** The board, drawn once a pixel at a time into its own canvas, again for a new theme. */
let board: HTMLCanvasElement | undefined;
let boardKey = '';
function boardOf(g: Ctx): HTMLCanvasElement {
	// The palette changes in place with the theme, so read it each time.
	const single = [C.shade, C.paper];
	const ring = [C.red, C.leaf];
	const key = [...single, ...ring, C.ink].join();
	if (board && key === boardKey) return board;
	boardKey = key;
	board = g.canvas.ownerDocument.createElement('canvas');
	board.width = W;
	board.height = H;
	const b = board.getContext('2d')!;
	for (let y = CY - DOUBLE[1] - 3; y <= CY + DOUBLE[1] + 3; y++) {
		for (let x = CX - DOUBLE[1] - 3; x <= CX + DOUBLE[1] + 3; x++) {
			const dx = x - CX;
			const dy = y - CY;
			const r = Math.hypot(dx, dy);
			if (r > DOUBLE[1] + 3) continue;
			const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1 + 1 / 40) % 1;
			const odd = Math.floor(turn * 20) % 2;
			const c =
				r > DOUBLE[1]
					? C.ink
					: r <= BULL
						? C.red
						: r <= OUTER_BULL
							? C.leaf
							: r >= DOUBLE[0] || (r >= TREBLE[0] && r <= TREBLE[1])
								? ring[odd]
								: single[odd];
			rect(b, x, y, 1, 1, c);
		}
	}
	text(b, '20', CX - 3, CY - DOUBLE[1] - 8, C.paper);
	return board;
}

/** A dart in the board: its tip at the pixel it scored, the flight up and right. */
function dart(g: Ctx, x: number, y: number) {
	outlined(
		g,
		[
			[x + 1, y - 1, 1, 1, C.lilac],
			[x + 2, y - 2, 1, 1, C.lilac],
			[x + 3, y - 5, 3, 3, C.amber],
		],
		C.ink,
	);
	rect(g, x, y, 1, 1, C.ink);
	rect(g, x + 4, y - 4, 1, 1, C.amberDark);
}

function draw(g: Ctx, r: Run) {
	// The corkboard, its grain, and two notes pinned beside the board.
	rect(g, 0, 0, W, H, C.cork);
	for (let i = 0; i < 90; i++) {
		const x = Math.floor(hash3(i, 1, 9) * W);
		const y = Math.floor(hash3(i, 2, 9) * H);
		rect(g, x, y, 1, 1, C.corkDark);
	}
	// Two notes pinned beside the board, a few lines written on each.
	for (const [x, y, w, h, paper, pin] of [
		[8, 10, 22, 18, C.paper, C.red],
		[128, 60, 22, 20, C.tealLight, C.violet],
	] as const) {
		rect(g, x + 1, y + 1, w, h, C.corkDark);
		rect(g, x, y, w, h, paper);
		for (let ly = y + 5; ly < y + h - 2; ly += 3)
			rect(g, x + 3, ly, w - 6 - (ly % 4), 1, C.cable);
		rect(g, x + w / 2 - 1, y - 1, 2, 2, pin);
	}
	g.drawImage(boardOf(g), 0, 0);
	for (const d of r.darts) dart(g, d.x, d.y);
	if (throwing(r) && (r.darts.length === 0 || r.since >= PAUSE_SEC)) {
		const aim = aimOf(r);
		const x = Math.round(aim.x);
		const y = Math.round(aim.y);
		// The aim: a ring of four arms in ink, and its middle, red once the hand shakes.
		const c = r.holding > SHAKE_SEC ? C.red : C.teal;
		outlined(
			g,
			[
				[x - 5, y, 3, 1, c],
				[x + 3, y, 3, 1, c],
				[x, y - 5, 1, 3, c],
				[x, y + 3, 1, 3, c],
			],
			C.ink,
		);
		rect(g, x, y, 1, 1, c);
	}
	const score = String(scoreOf(r));
	text(g, score, W - textWidth(score) - 3, 3, C.ink);
	for (let i = 0; i < DARTS - r.darts.length; i++)
		rect(g, 3 + i * 5, 3, 3, 5, C.amber);
	const last = r.darts.at(-1);
	if (last && r.since < PAUSE_SEC) {
		const said = String(last.points);
		text(g, said, Math.round((W - textWidth(said)) / 2), 84, C.ink);
	}
}

export const DARTS_GAME: Game<Run> = {
	id: 'darts',
	name: 'Darts',
	how: 'Three darts at the corkboard. Hold to steady your aim, let go to throw, and don’t hold so long your hand shakes.',
	most: 180,
	button: 'Hold to aim, let go to throw',
	start: newRun,
	step,
	over,
	score: scoreOf,
	sound: (_before, after) => after.last,
	draw,
};
