/**
 * The lounge as one frame (ADR-0094): what the picture needs to know, where
 * its clickable things sit, and the order it is painted in.
 */
import type { Ctx } from '$lib/lounge/pixel';
import type { Weather } from '$lib/lounge/state';
import type { Sky } from '$lib/lounge/palette';
import { drawRoom, drawShade } from '$lib/lounge/draw-room';
import { drawWindow } from '$lib/lounge/draw-window';
import { drawPeople } from '$lib/lounge/draw-people';

export const SCENE_W = 320;
export const SCENE_H = 180;
/** The sofa's seats; anyone past them is counted on its arm. */
export const SEATS = 5;

/** Someone in the voice channel, as the scene dresses them. */
export interface Figure {
	id: string;
	name: string;
	skin: string;
	hair: string;
	shirt: string;
	speaking: boolean;
	/** Their away reason ('' for plain away), or undefined while here. */
	away?: string;
}

export interface Rider extends Figure {
	watts: number;
	/** Where the cranks are, in radians: the component turns them at the rider's cadence. */
	crank: number;
}

export interface Heart {
	/** Seat index the cheer rose from. */
	seat: number;
	born: number;
}

export interface SceneInput {
	/** Seconds on the scene's own clock; held still under reduced motion. */
	t: number;
	still: boolean;
	sky: Sky;
	weather: Weather;
	lampOn: boolean;
	seated: Figure[];
	rider?: Rider;
	/** Whether something plays: the platter turns and its light is on. */
	playing: boolean;
	/** Beats on the music's clock, and whether there is a beat to follow. */
	beat: number;
	pulsing: boolean;
	catAwakeUntil: number;
	hearts: Heart[];
	/** The watt hue, read from the theme. */
	watt: string;
	/** The viewer's own time, for the wall clock. */
	hours: number;
	minutes: number;
}

/** How hard things move on this beat: a kick's fall-off, or a slow idle. */
export function pulseOf(input: SceneInput): number {
	if (input.still) return 0.8;
	if (!input.pulsing) return 0.75 + 0.1 * Math.sin(input.t);
	const f = input.beat - Math.floor(input.beat);
	return Math.exp(-f * 5);
}

export function drawScene(g: Ctx, input: SceneInput) {
	drawRoom(g, input);
	drawWindow(g, input);
	drawPeople(g, input);
	drawShade(g, input);
}

export type Spot = 'cat' | 'lamp' | 'deck' | 'window' | 'bike' | 'sofa';

const SPOTS: { spot: Spot; x: number; y: number; w: number; h: number }[] = [
	{ spot: 'cat', x: 224, y: 88, w: 26, h: 22 },
	{ spot: 'lamp', x: 96, y: 92, w: 20, h: 28 },
	{ spot: 'deck', x: 262, y: 100, w: 50, h: 22 },
	{ spot: 'deck', x: 288, y: 132, w: 24, h: 30 },
	{ spot: 'bike', x: 145, y: 112, w: 75, h: 54 },
	{ spot: 'sofa', x: 34, y: 126, w: 104, h: 36 },
	{ spot: 'window', x: 122, y: 22, w: 136, h: 86 },
];

/** What a click at scene coordinates lands on, first match wins. */
export function spotAt(x: number, y: number): Spot | undefined {
	return SPOTS.find(
		(s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h,
	)?.spot;
}

/** The seat under a click on the sofa, or -1. */
export function seatAt(x: number, seated: number): number {
	const i = Math.floor((x - SEAT_X0) / SEAT_STEP);
	return i >= 0 &&
		i < Math.min(seated, SEATS) &&
		x - SEAT_X0 - i * SEAT_STEP < 12
		? i
		: -1;
}

export const SEAT_X0 = 42;
export const SEAT_STEP = 18;
