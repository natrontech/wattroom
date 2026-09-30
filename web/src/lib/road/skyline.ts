import { heightAt } from './at-metre';
import type { Climb } from './climbs';
import { roadStep, type Road } from './road';

/**
 * The Skyline (#3059, ADR-0066): the 2D road ahead in slot 5, and the world's
 * fallback. Pure: what is drawn where, for a slot of a given size; the
 * component only steps it. The numbers are #3059's, decided 2026-09-29.
 */
export const SKYLINE = {
	/** The window: this far behind the dot… */
	behindM: 500,
	/** …and this far ahead of it, between 15 and 40 km/h. */
	aheadM: 3000,
	slowKph: 15,
	slowAheadM: 1500,
	fastKph: 40,
	fastAheadM: 5000,
	/** A new reach ahead is eased to over this long. */
	easeS: 10,
	/** The heights in view fill this share of the slot… */
	spanShare: 0.7,
	/** …over at least this many metres of height. */
	spanFloorM: 120,
	/** Every SVG node the Skyline draws, together. */
	maxNodes: 300,
	/** Widest a tile may be. */
	tilePx: 4096,
	/** Stepped at most this often… */
	stepHz: 10,
	/** …and only once a tick below this, as under reduced motion. */
	stillKph: 8,
	/** The five grade steps' edges, %: under 3, 3–6, 6–9, 9–12, over 12. */
	gradeEdges: [3, 6, 9, 12],
} as const;

/** How far ahead the speed asks the window to reach. */
export function aheadFor(mps: number): number {
	const kph = mps * 3.6;
	if (kph < SKYLINE.slowKph) return SKYLINE.slowAheadM;
	if (kph > SKYLINE.fastKph) return SKYLINE.fastAheadM;
	return SKYLINE.aheadM;
}

/**
 * The reach ahead, eased to each new target over `easeS` from wherever it
 * was — a smoothstep, so it neither jumps nor lingers.
 */
export function createAheadEase(start: number = SKYLINE.aheadM) {
	let from = start;
	let to = start;
	let t: number = SKYLINE.easeS;
	let value = start;
	return {
		/** Advance by `dt` seconds towards `target`; the reach now. */
		step(target: number, dt: number): number {
			if (target !== to) {
				from = value;
				to = target;
				t = 0;
			}
			t = Math.min(SKYLINE.easeS, t + dt);
			const k = t / SKYLINE.easeS;
			value = from + (to - from) * k * k * (3 - 2 * k);
			return value;
		},
	};
}

/** Whether a speed and the rider's motion setting step once a tick. */
export const stepsPerTick = (mps: number, reduced: boolean): boolean =>
	reduced || mps * 3.6 < SKYLINE.stillKph;

/**
 * Each grade step's fill, gentlest first (app.css, gated in
 * grade-ramp.test.ts): the Skyline's and the HUD's strip's one ramp.
 */
export const GRADE_FILL = [
	'fill-grade-1',
	'fill-grade-2',
	'fill-grade-3',
	'fill-grade-4',
	'fill-grade-5',
];

/** The same ramp as a background: the climb card's 100 m bars (#3645). */
export const GRADE_BG = [
	'bg-grade-1',
	'bg-grade-2',
	'bg-grade-3',
	'bg-grade-4',
	'bg-grade-5',
];

/** 0–4: which of the five steps a grade falls in. A descent is the first. */
export function gradeStep(pct: number): number {
	return SKYLINE.gradeEdges.filter((edge) => pct >= edge).length;
}

/** The slot's geometry for a window: metres to px, and heights to px. */
export interface Frame {
	/** px per metre along the road. */
	scale: number;
	/** The window's first metre (may be before the road). */
	fromM: number;
	/** The lowest height in view, and the span the slot's share covers. */
	lo: number;
	span: number;
	width: number;
	height: number;
}

export function frameFor(
	road: Road,
	m: number,
	ahead: number,
	width: number,
	height: number,
): Frame {
	const fromM = m - SKYLINE.behindM;
	const toM = m + ahead;
	const step = roadStep(road);
	let lo = Infinity;
	let hi = -Infinity;
	const first = Math.max(0, Math.floor(fromM / step));
	const last = Math.min(road.heights.length - 1, Math.ceil(toM / step));
	for (let i = first; i <= last; i++) {
		lo = Math.min(lo, road.heights[i]);
		hi = Math.max(hi, road.heights[i]);
	}
	if (!Number.isFinite(lo)) lo = hi = heightAt(road, m);
	return {
		scale: width / (SKYLINE.behindM + ahead),
		fromM,
		lo,
		span: Math.max(hi - lo, SKYLINE.spanFloorM),
		width,
		height,
	};
}

/** A height, in px from the slot's top: the span fills its share, from the bottom. */
export const yOf = (frame: Frame, h: number): number =>
	frame.height -
	((h - frame.lo) / frame.span) * frame.height * SKYLINE.spanShare;

/** Whole metres a tile covers at this scale: as wide as it may be, and no wider. */
export const tileM = (frame: Frame): number =>
	Math.floor(SKYLINE.tilePx / frame.scale);

/**
 * The tiles the window touches, by index along the road, and those the dot
 * drifts into over `driftM` before the next second redraws the frame.
 */
export function tilesIn(frame: Frame, road: Road, driftM = 0): number[] {
	const span = tileM(frame);
	const first = Math.max(0, Math.floor(frame.fromM / span));
	const last = Math.min(
		Math.floor(road.length / span),
		Math.floor((frame.fromM + frame.width / frame.scale + driftM) / span),
	);
	const out: number[] = [];
	for (let i = first; i <= last; i++) out.push(i);
	return out;
}

/** One tile's drawing, in its own px from its left edge: an area per grade step, and the line. */
export interface Tile {
	index: number;
	/** px from the road's start to the tile's left edge. */
	left: number;
	width: number;
	/** Five area paths, one per grade step; '' where the tile has none. */
	areas: string[];
	line: string;
}

export function tileOf(frame: Frame, road: Road, index: number): Tile {
	const span = tileM(frame);
	const startM = index * span;
	const endM = Math.min(road.length, startM + span);
	const step = roadStep(road);
	const first = Math.floor(startM / step);
	const last = Math.min(road.heights.length - 1, Math.ceil(endM / step));
	const x = (i: number) => ((i * step - startM) * frame.scale).toFixed(1);
	const y = (i: number) => yOf(frame, road.heights[i]).toFixed(1);
	const base = frame.height.toFixed(1);
	const areas = ['', '', '', '', ''];
	let line = '';
	let run = -1;
	let runStart = first;
	const close = (to: number) => {
		if (run < 0) return;
		let d = `M${x(runStart)},${base}`;
		for (let i = runStart; i <= to; i++) d += `L${x(i)},${y(i)}`;
		areas[run] += `${d}L${x(to)},${base}Z`;
	};
	for (let i = first; i < last; i++) {
		const s = gradeStep(((road.heights[i + 1] - road.heights[i]) / step) * 100);
		if (s !== run) {
			close(i);
			run = s;
			runStart = i;
		}
	}
	close(last);
	for (let i = first; i <= last; i++)
		line += `${i === first ? 'M' : 'L'}${x(i)},${y(i)}`;
	return {
		index,
		left: startM * frame.scale,
		width: (endM - startM) * frame.scale,
		areas,
		line,
	};
}

/**
 * A climb's chip where it tops out, for the climbs in view that have a class.
 * In road px, like the tiles: they move with the road.
 */
export function chipsIn(
	frame: Frame,
	road: Road,
	climbs: Climb[],
): { cls: string; x: number; y: number }[] {
	const toM = frame.fromM + frame.width / frame.scale;
	return climbs
		.filter((c) => c.cls && c.topM >= frame.fromM && c.topM <= toM)
		.map((c) => ({
			cls: c.cls as string,
			x: c.topM * frame.scale,
			y: yOf(frame, heightAt(road, c.topM)),
		}));
}

/** A block of a road workout: metres along the road, and its zone. */
export interface BandBlock {
	fromM: number;
	toM: number;
	zone: number;
}

/** The interval band's blocks in view, in road px. */
export function bandIn(
	frame: Frame,
	band: BandBlock[],
): { x: number; width: number; zone: number }[] {
	const toM = frame.fromM + frame.width / frame.scale;
	return band
		.filter((b) => b.toM > frame.fromM && b.fromM < toM)
		.map((b) => {
			const from = Math.max(b.fromM, frame.fromM);
			const to = Math.min(b.toM, toM);
			return {
				x: from * frame.scale,
				width: (to - from) * frame.scale,
				zone: b.zone,
			};
		});
}

/** Every SVG node a frame draws: an area per grade step that has one, and a line, per tile. */
export const nodesOf = (tiles: Tile[]): number =>
	tiles.reduce((n, t) => n + t.areas.filter(Boolean).length + 1, 0);

/** Everything the Skyline draws a ride from, handed through a surface to TV mode too. */
export interface SkylineView {
	road: Road;
	/** The dot: metres along `road`. */
	m: number;
	mps: number;
	band?: BandBlock[];
	/** The lap rides `road` back from its far end (#3205). */
	reverse?: boolean;
}
