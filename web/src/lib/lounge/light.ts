/**
 * How the lounge is lit: baked into the still picture whenever the lamp, the
 * stove, the sky or the room changes. Every pixel steps its colour up toward
 * the warm or cool light that reaches it, or down into the dark, by whole
 * bands split by an ordered dither. So light falls on the things it reaches,
 * with no blend between pixels and a few extra colours for each material.
 */
import { BAYER } from '$lib/lounge/pixel';
import type { Sky } from '$lib/lounge/palette';

/** A light's reach: an ellipse, on the wall, on the floor, or on both. */
export interface Light {
	x: number;
	y: number;
	rx: number;
	ry: number;
	power: number;
	/** The window at night: moonlight, against the room's amber. */
	cool?: boolean;
	on?: 'wall' | 'floor';
}

/** How far a colour may step either way, and how far each step takes it. */
export const BANDS = 3;
const LIT_STEP = 0.13;
const DARK_STEP = 0.17;

/** The dark the lights lift: a little everywhere at night, more toward the edges. */
export const DARKNESS: Record<Sky, { base: number; edge: number }> = {
	night: { base: -0.1, edge: 0.75 },
	dusk: { base: -0.04, edge: 0.55 },
	day: { base: 0, edge: 0.12 },
};

function reach(l: Light, x: number, y: number, floorRow: number): number {
	if (l.on === 'wall' && y >= floorRow) return 0;
	if (l.on === 'floor' && y < floorRow) return 0;
	const dx = (x - l.x) / l.rx;
	const dy = (y - l.y) / l.ry;
	const d = dx * dx + dy * dy;
	return d >= 1 ? 0 : l.power * (1 - d) * (1 - d);
}

/** The light on one pixel: its step, -BANDS to BANDS, and whether the moon gave most of it. */
export function stepAt(
	x: number,
	y: number,
	lights: readonly Light[],
	dark: { base: number; edge: number },
	room: { w: number; h: number; floorRow: number },
): { step: number; cool: boolean } {
	let warm = 0;
	let cool = 0;
	for (const l of lights) {
		const r = reach(l, x, y, room.floorRow);
		if (l.cool) cool += r;
		else warm += r;
	}
	const ex = Math.abs(x / room.w - 0.5) * 2;
	const ey = Math.abs(y / room.h - 0.5) * 2;
	const edge = Math.max(ex, ey);
	const level = dark.base - dark.edge * edge * edge + warm + cool;
	const threshold = BAYER[(y & 3) * 4 + (x & 3)] / 16;
	const step = Math.floor(level * BANDS + threshold);
	return {
		step: Math.max(-BANDS, Math.min(BANDS, step)),
		cool: cool > warm,
	};
}

const rgb = (hex: string) => [
	parseInt(hex.slice(1, 3), 16),
	parseInt(hex.slice(3, 5), 16),
	parseInt(hex.slice(5, 7), 16),
];

/** Bake `lights` into what is on `g`, in place. */
export function bakeLight(
	g: CanvasRenderingContext2D,
	lights: readonly Light[],
	sky: Sky,
	room: { w: number; h: number; floorRow: number },
	colours: { warm: string; cool: string; shade: string },
) {
	const picture = g.getImageData(0, 0, room.w, room.h);
	const px = picture.data;
	const warm = rgb(colours.warm);
	const cool = rgb(colours.cool);
	const shade = rgb(colours.shade);
	const toned = new Map<number, number>();
	const dark = DARKNESS[sky];
	for (let y = 0, i = 0; y < room.h; y++)
		for (let x = 0; x < room.w; x++, i += 4) {
			const { step, cool: moon } = stepAt(x, y, lights, dark, room);
			if (!step) continue;
			const was = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
			const key = was * 16 + (step + BANDS) * 2 + (moon ? 1 : 0);
			let now = toned.get(key);
			if (now === undefined) {
				const to = step < 0 ? shade : moon ? cool : warm;
				const k = step < 0 ? -step * DARK_STEP : step * LIT_STEP;
				const mix = (v: number, c: number) => Math.round(v + (c - v) * k);
				now =
					(mix(px[i], to[0]) << 16) |
					(mix(px[i + 1], to[1]) << 8) |
					mix(px[i + 2], to[2]);
				toned.set(key, now);
			}
			px[i] = now >> 16;
			px[i + 1] = (now >> 8) & 255;
			px[i + 2] = now & 255;
		}
	g.putImageData(picture, 0, 0);
}
