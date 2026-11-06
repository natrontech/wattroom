/**
 * The window: a synthwave horizon under the viewer's own sky, the crew's
 * weather over it, and whatever the clock flies past it (moments.ts).
 * Everything that moves here is a function of the clock, so the scene keeps
 * no particles of its own.
 */
import { LOUNGE as C, SKIES, SUNS, type Sky } from '$lib/lounge/palette';
import { disc, dot, line, rect, type Ctx } from '$lib/lounge/pixel';
import type { SceneInput } from '$lib/lounge/scene';
import type { Flyby } from '$lib/lounge/moments';
import { hash3 } from '$lib/lounge/hash';

/** The glass, in the stage's coordinates; its frame and sill are drawn with the room. */
export const WINDOW = { X: 118, Y: 10, W: 84, H: 44 } as const;
const { X, Y, W, H } = WINDOW;
const HORIZON = Y + 30;
const SUN_X = 160;

export function drawWindow(g: Ctx, s: SceneInput) {
	g.save();
	g.beginPath();
	g.rect(X, Y, W, H);
	g.clip();
	g.drawImage(backdrop(s.sky), X, Y, W, H, X, Y, W, H);
	stars(g, s);
	buildings(g, s);
	ground(g, s);
	if (s.flyby) flyby(g, s, s.flyby);
	weather(g, s);
	pastTheWindow(g, s);
	g.restore();
	if (s.season === 'halloween') pumpkin(g, s);
}

/** What the calendar sends past the glass: blossom, leaves, or fireworks. */
function pastTheWindow(g: Ctx, s: SceneInput) {
	if (s.moment === 'blossom' || s.moment === 'leaves') {
		const blossom = s.moment === 'blossom';
		const hues = blossom
			? [C.heart, C.paper]
			: [C.amber, C.amberDark, C.redLight];
		for (let i = 0; i < 26; i++) {
			const fall = (hash3(i, 5, 1) * H + (s.still ? 0 : s.t * 7)) % H;
			const sway = s.still ? 0 : Math.sin(s.t * 1.2 + i) * 4;
			rect(
				g,
				X + hash3(i, 5, 2) * W + sway - fall * 0.3,
				Y + fall,
				blossom ? 1 : 2,
				1,
				hues[i % hues.length],
			);
		}
	}
	if (s.moment !== 'newyear' && s.moment !== 'august') return;
	const hues =
		s.moment === 'august'
			? [C.redLight, C.paper, C.red]
			: [C.amber, C.teal, C.heart, C.lilac];
	const BURST_SEC = 2.6;
	for (let b = 0; b < 3; b++) {
		const clock = (s.still ? 1.3 : s.t) / BURST_SEC + b / 3;
		const slot = Math.floor(clock) + b * 40;
		const age = clock - Math.floor(clock);
		const cx = X + 10 + hash3(slot, b, 1) * (W - 20);
		const cy = Y + 6 + hash3(slot, b, 2) * 18;
		const hue = hues[Math.floor(hash3(slot, b, 3) * hues.length)];
		if (age < 0.2) {
			rect(g, cx, cy + (0.2 - age) * 60, 1, 2, C.bulb);
			continue;
		}
		const r = (age - 0.2) * 16;
		for (let i = 0; i < 12; i++) {
			if (age > 0.75 && i % 2) continue;
			const a = (i / 12) * Math.PI * 2;
			dot(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r + age * 3, hue);
		}
	}
}

/** Across the window at the moment the slot gives, the same on every screen. */
function flyby(g: Ctx, s: SceneInput, { kind, f, dir }: Flyby) {
	const along = dir > 0 ? f : 1 - f;
	const x = Math.round(X - 12 + along * (W + 24));
	const blink = s.still || Math.floor(s.t * 2) % 2 === 0;
	if (kind === 'plane') {
		rect(g, x - 4, Y + 8, 9, 1, C.lilac);
		rect(g, x - dir * 3, Y + 6, 1, 2, C.lilac);
		if (blink) dot(g, x + dir * 4, Y + 8, C.heart);
	} else if (kind === 'birds')
		for (let i = 0; i < 4; i++) {
			const bx = x - dir * i * 6;
			const by = Y + 12 + (i % 2) * 3;
			const up = !s.still && Math.floor(s.t * 6 + i) % 2 === 0;
			dot(g, bx - 1, by - (up ? 1 : 0), C.ink);
			dot(g, bx, by, C.ink);
			dot(g, bx + 1, by - (up ? 1 : 0), C.ink);
		}
	else if (kind === 'balloon') {
		const y = Y + 16 + Math.round(Math.sin(f * 6) * 2);
		disc(g, x, y, 5, C.bookC);
		rect(g, x - 1, y - 5, 2, 11, C.amber);
		line(g, x - 3, y + 4, x - 1, y + 8, C.ink);
		line(g, x + 3, y + 4, x + 1, y + 8, C.ink);
		rect(g, x - 1, y + 8, 3, 2, C.wood);
	} else if (kind === 'peloton')
		// A bunch on the road at the horizon: the world's riders, very far off.
		for (let i = 0; i < 5; i++) {
			const rx = x - dir * i * 4;
			const bob = !s.still && Math.floor(s.t * 6 + i) % 2 === 0 ? 1 : 0;
			rect(g, rx, HORIZON + 3 - bob, 1, 2, [C.teal, C.amber, C.heart][i % 3]);
			dot(g, rx - 1, HORIZON + 5, C.lilac);
			dot(g, rx + 1, HORIZON + 5, C.lilac);
		}
	else {
		const y = Y + 9 + Math.round(Math.sin(f * 9) * 3);
		rect(g, x - 4, y, 9, 2, C.lilac);
		rect(g, x - 2, y - 2, 5, 2, C.tealLight);
		if (blink) {
			g.globalAlpha = 0.4;
			g.fillStyle = C.tealLight;
			g.beginPath();
			g.moveTo(x - 2, y + 2);
			g.lineTo(x + 2, y + 2);
			g.lineTo(x + 6, HORIZON);
			g.lineTo(x - 6, HORIZON);
			g.closePath();
			g.fill();
			g.globalAlpha = 1;
		}
	}
}

/** Halloween week: a lit pumpkin at the sill's left end. */
function pumpkin(g: Ctx, s: SceneInput) {
	const y = Y + H + 2;
	disc(g, 131, y - 4, 4, C.ink);
	disc(g, 131, y - 4, 3, C.amber);
	rect(g, 131, y - 9, 1, 2, C.leaf);
	const lit = s.still || Math.sin(s.t * 3) > -0.7;
	const eye = lit ? C.bulb : C.ink;
	dot(g, 129, y - 5, eye);
	dot(g, 133, y - 5, eye);
	rect(g, 130, y - 3, 3, 1, eye);
}

/**
 * The sky, its sun and the mountains change only with the sky itself, and
 * drawn pixel by pixel they were most of a frame: each sky is drawn once.
 */
const backdrops = new Map<Sky, HTMLCanvasElement>();

/** The theme changed: every sky is drawn again in its colours. */
export function forgetBackdrops() {
	backdrops.clear();
}

function backdrop(kind: Sky): HTMLCanvasElement {
	let made = backdrops.get(kind);
	if (made) return made;
	made = document.createElement('canvas');
	made.width = X + W;
	made.height = Y + H;
	const g = made.getContext('2d')!;
	sky(g, kind);
	mountains(g);
	backdrops.set(kind, made);
	return made;
}

function sky(g: Ctx, kind: Sky) {
	const bands = SKIES[kind];
	const rows = HORIZON - Y;
	for (let y = 0; y < rows; y++) {
		const f = (y / rows) * bands.length;
		const b = Math.min(bands.length - 1, Math.floor(f));
		// A checker row where two bands meet: pixel art's gradient.
		if (f - b > 0.78 && b < bands.length - 1)
			for (let x = 0; x < W; x++)
				dot(g, X + x, Y + y, (x + y) & 1 ? bands[b + 1] : bands[b]);
		else rect(g, X, Y + y, W, 1, bands[b]);
	}
	const [top, bottom] = SUNS[kind];
	const r = 13;
	for (let dy = 1; dy <= r; dy++) {
		if (dy <= 7 && dy % 3 === 0) continue;
		const w = Math.floor(Math.sqrt(r * r - dy * dy));
		rect(g, SUN_X - w, HORIZON - dy, w * 2 + 1, 1, dy > r / 2 ? top : bottom);
	}
}

function mountains(g: Ctx) {
	for (let x = 0; x < W; x++) {
		const h = Math.round(
			5 + 3 * Math.sin(x * 0.11) + 2 * Math.sin(x * 0.27 + 1),
		);
		rect(g, X + x, HORIZON - h, 1, h, C.mountain);
	}
}

/** Above the sun's top and the mountains, so drawing them after hides nothing. */
function stars(g: Ctx, s: SceneInput) {
	if (s.weather !== 'clear' || s.sky !== 'night') return;
	for (let i = 0; i < 26; i++) {
		const twinkle = s.still ? 1 : Math.sin(s.t * 1.3 + i * 4);
		if (twinkle > -0.6)
			dot(
				g,
				X + Math.floor(hash3(i, 1, 9) * W),
				Y + 1 + Math.floor(hash3(i, 2, 9) * 18),
				twinkle > 0.7 ? C.star : C.lilac,
			);
	}
}

function buildings(g: Ctx, s: SceneInput) {
	// Buildings are seeded; a lit window changes every few seconds.
	for (let x = 0, i = 0; x < W; i++) {
		const w = 3 + Math.floor(hash3(i, 7, 1) * 5);
		const h = 4 + Math.floor(hash3(i, 7, 2) * 11);
		rect(g, X + x, HORIZON - h, w, h, C.city);
		const era = s.still ? 0 : Math.floor(s.t / 5 + i * 0.37);
		for (let wy = HORIZON - h + 2; wy < HORIZON - 1; wy += 3)
			for (let wx = X + x + 1; wx < X + x + w - 1; wx += 2)
				if (hash3(wx, wy, era) > 0.74) dot(g, wx, wy, C.amber);
		x += w + (hash3(i, 7, 3) < 0.3 ? 1 : 0);
	}
}

function ground(g: Ctx, s: SceneInput) {
	rect(g, X, HORIZON, W, Y + H - HORIZON, C.ground);
	const scroll = s.still ? 0 : (s.t * 0.35) % 1;
	const deep = Y + H - HORIZON - 1;
	for (let n = 0; n < 5; n++) {
		const p = (n + scroll) / 5;
		rect(g, X, HORIZON + 1 + Math.floor(deep * p * p), W, 1, C.grid);
	}
	for (let k = -7; k <= 7; k++)
		line(g, SUN_X, HORIZON, SUN_X + k * 14, Y + H, C.grid);
}

function weather(g: Ctx, s: SceneInput) {
	if (s.weather === 'rain')
		for (let i = 0; i < 70; i++) {
			const fall =
				((hash3(i, 3, 1) * (H + 8) + (s.still ? 0 : s.t * 75)) % (H + 8)) - 4;
			const x =
				X + ((hash3(i, 3, 2) * (W + 24) - fall * 0.24 + W + 24) % (W + 24));
			rect(g, x, Y + fall, 1, 3, C.rain);
		}
	if (s.weather === 'snow')
		for (let i = 0; i < 50; i++) {
			const fall = (hash3(i, 4, 1) * H + (s.still ? 0 : s.t * 9)) % H;
			const x = X + hash3(i, 4, 2) * W + (s.still ? 0 : Math.sin(s.t + i) * 2);
			dot(g, x, Y + fall, C.snow);
		}
}
