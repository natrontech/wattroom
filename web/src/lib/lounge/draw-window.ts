/**
 * The window: a synthwave horizon under the viewer's own sky, the crew's
 * weather over it, and the cat asleep on the sill. Everything that moves here
 * is a function of the clock, so the scene keeps no particles of its own.
 */
import { LOUNGE as C, SKIES, SUNS } from '$lib/lounge/palette';
import { dot, line, rect, sprite, type Ctx } from '$lib/lounge/pixel';
import type { SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

const X = 122;
const Y = 22;
const W = 136;
const H = 86;
const HORIZON = 88;
const SUN_X = 190;
const Z = ['111', '010', '111'];

export function drawWindow(g: Ctx, s: SceneInput) {
	g.save();
	g.beginPath();
	g.rect(X, Y, W, H);
	g.clip();
	sky(g, s);
	skyline(g, s);
	ground(g, s);
	weather(g, s);
	g.restore();
	rect(g, X - 2, Y - 2, W + 4, 2, C.frame);
	rect(g, X - 2, Y, 2, H, C.frame);
	rect(g, X + W, Y, 2, H, C.frame);
	rect(g, X - 6, Y + H, W + 12, 4, C.trim);
	rect(g, X - 6, Y + H, W + 12, 1, C.sillTop);
	cat(g, s);
}

function sky(g: Ctx, s: SceneInput) {
	const bands = SKIES[s.sky];
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
	if (s.weather === 'clear' && s.sky === 'night')
		for (let i = 0; i < 26; i++) {
			const twinkle = s.still ? 1 : Math.sin(s.t * 1.3 + i * 4);
			if (twinkle > -0.6)
				dot(
					g,
					X + Math.floor(hash3(i, 1, 9) * W),
					Y + 1 + Math.floor(hash3(i, 2, 9) * 32),
					twinkle > 0.7 ? C.star : C.lilac,
				);
		}
	const [top, bottom] = SUNS[s.sky];
	const r = 17;
	for (let dy = 1; dy <= r; dy++) {
		if (dy <= 9 && dy % 3 === 0) continue;
		const w = Math.floor(Math.sqrt(r * r - dy * dy));
		rect(g, SUN_X - w, HORIZON - dy, w * 2 + 1, 1, dy > r / 2 ? top : bottom);
	}
}

function skyline(g: Ctx, s: SceneInput) {
	for (let x = 0; x < W; x++) {
		const h = Math.round(
			7 + 4 * Math.sin(x * 0.09) + 3 * Math.sin(x * 0.23 + 1),
		);
		rect(g, X + x, HORIZON - h, 1, h, C.mountain);
	}
	// Buildings are seeded; a lit window changes every few seconds.
	for (let x = 0, i = 0; x < W; i++) {
		const w = 4 + Math.floor(hash3(i, 7, 1) * 6);
		const h = 5 + Math.floor(hash3(i, 7, 2) * 15);
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
	for (let n = 0; n < 7; n++) {
		const p = (n + scroll) / 7;
		rect(g, X, HORIZON + 1 + Math.floor(19 * p * p), W, 1, C.grid);
	}
	for (let k = -9; k <= 9; k++)
		line(g, SUN_X, HORIZON, SUN_X + k * 18, Y + H, C.grid);
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
			const x = X + hash3(i, 4, 2) * W + Math.sin(s.t + i) * 2;
			dot(g, x, Y + fall, C.snow);
		}
}

/** Asleep unless someone woke it; it falls back asleep on its own. */
function cat(g: Ctx, s: SceneInput) {
	const y = Y + H;
	if (s.catAwakeUntil > s.t) {
		const flick = s.still ? 0 : Math.round(Math.sin(s.t * 6) * 1.5);
		rect(g, 232, y - 12, 9, 12, C.cat);
		rect(g, 233, y - 18, 8, 6, C.cat);
		dot(g, 233, y - 19, C.cat);
		dot(g, 240, y - 19, C.cat);
		dot(g, 235, y - 16, C.amber);
		dot(g, 238, y - 16, C.amber);
		rect(g, 241, y - 3, 5, 2, C.catLight);
		rect(g, 245, y - 7 + flick, 2, 5, C.catLight);
		return;
	}
	rect(g, 230, y - 5, 14, 5, C.cat);
	rect(g, 231, y - 6, 12, 1, C.cat);
	rect(g, 240, y - 8, 6, 5, C.cat);
	dot(g, 240, y - 9, C.cat);
	dot(g, 245, y - 9, C.cat);
	rect(g, 242, y - 6, 2, 1, C.ink);
	rect(g, 226, y - 2, 5, 2, C.catLight);
	if (s.still) return;
	for (const offset of [0, 1.2]) {
		const a = (s.t + offset) % 2.4;
		sprite(g, Z, Math.round(246 + a * 2), Math.round(y - 11 - a * 4), C.lilac);
	}
}
