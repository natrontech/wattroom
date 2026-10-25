/**
 * WCAG 2.3.1 over sampled frames (#3223, ADR-0064, ADR-0072). Frames are
 * downscaled to 128 x 96, so the 10 degree field's 341 x 256 px at 1024 x 768 is
 * a 43 x 32 window; a flash needs a quarter of a window to change at once.
 * ponytail: the best window per frame pair, not per pixel track; a flash is an
 * opposing pair of such frame-pair events. Tighten if it misses a real one.
 */
export const W = 128;
export const H = 96;
const WIN_W = 43;
const WIN_H = 32;
const STRIDE = 4;

export interface Frame {
	/** Milliseconds since the first frame. */
	t: number;
	/** W * H * 3 sRGB bytes. */
	rgb: Uint8Array;
}

const lin = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));

/** Relative luminance, and the red test's (R-G-B)*320 with its saturation gate. */
function planes(rgb: Uint8Array) {
	const lum = new Float32Array(W * H);
	const red = new Float32Array(W * H);
	const saturated = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) {
		const r = LIN[rgb[i * 3]];
		const g = LIN[rgb[i * 3 + 1]];
		const b = LIN[rgb[i * 3 + 2]];
		lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		red[i] = (r - g - b) * 320;
		saturated[i] = r + g + b > 0 && r / (r + g + b) >= 0.8 ? 1 : 0;
	}
	return { lum, red, saturated };
}

/** The most pixels of `mask` any window holds. */
function densest(mask: Uint8Array): number {
	const sat = new Int32Array((W + 1) * (H + 1));
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			sat[(y + 1) * (W + 1) + x + 1] =
				mask[y * W + x] +
				sat[y * (W + 1) + x + 1] +
				sat[(y + 1) * (W + 1) + x] -
				sat[y * (W + 1) + x];
	let best = 0;
	for (let y = 0; y + WIN_H <= H; y += STRIDE)
		for (let x = 0; x + WIN_W <= W; x += STRIDE) {
			const n =
				sat[(y + WIN_H) * (W + 1) + x + WIN_W] -
				sat[y * (W + 1) + x + WIN_W] -
				sat[(y + WIN_H) * (W + 1) + x] +
				sat[y * (W + 1) + x];
			if (n > best) best = n;
		}
	return best;
}

/** +1 or -1 where a window flashed brighter or darker (or redder) between two frames; 0 otherwise. */
function direction(a: ReturnType<typeof planes>, b: ReturnType<typeof planes>) {
	const need = 0.25 * WIN_W * WIN_H;
	const result = { lum: 0, red: 0 };
	const up = new Uint8Array(W * H);
	const down = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) {
		const d = b.lum[i] - a.lum[i];
		up[i] = d >= 0.1 && a.lum[i] < 0.8 ? 1 : 0;
		down[i] = -d >= 0.1 && b.lum[i] < 0.8 ? 1 : 0;
	}
	if (densest(up) >= need) result.lum = 1;
	else if (densest(down) >= need) result.lum = -1;
	const rUp = new Uint8Array(W * H);
	const rDown = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) {
		if (!a.saturated[i] && !b.saturated[i]) continue;
		const d = b.red[i] - a.red[i];
		rUp[i] = d > 20 ? 1 : 0;
		rDown[i] = -d > 20 ? 1 : 0;
	}
	if (densest(rUp) >= need) result.red = 1;
	else if (densest(rDown) >= need) result.red = -1;
	return result;
}

/** Times (ms) at which a flash completes: an opposing pair of changes, luminance or red. */
export function flashTimes(frames: Frame[]): number[] {
	const times: number[] = [];
	const last = { lum: 0, red: 0 };
	let prev = planes(frames[0].rgb);
	for (let i = 1; i < frames.length; i++) {
		const next = planes(frames[i].rgb);
		const d = direction(prev, next);
		for (const k of ['lum', 'red'] as const) {
			if (d[k] === 0) continue;
			if (last[k] === -d[k]) {
				times.push(frames[i].t);
				last[k] = 0;
			} else last[k] = d[k];
		}
		prev = next;
	}
	return times;
}

/** The most flashes in any window of `spanMs`. */
export function mostIn(times: number[], spanMs: number): number {
	let best = 0;
	for (let i = 0, j = 0; i < times.length; i++) {
		while (times[i] - times[j] >= spanMs) j++;
		best = Math.max(best, i - j + 1);
	}
	return best;
}

/** The budget (at most 1 per 10 s) and the hard limit (never 3 per second). */
export function verdict(frames: Frame[]) {
	const times = flashTimes(frames);
	return {
		times,
		per10s: mostIn(times, 10_000),
		perSecond: mostIn(times, 1000),
	};
}
