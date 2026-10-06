// A cheer for one rider (#3116), as the world draws it: a thumbs-up over
// their head, then their tail light blinking. Social, never a reward, so it
// is flat and unlit like the chevron and nothing about it glows (ADR-0005).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bezier, DUR, EASE, HOLD_ANNOUNCE } from '$lib/motion/tokens';

/** Seconds the tail light answers a cheer (#3116). */
export const CHEER_S = 10;
/** The tail light's blink: a small light, far under WCAG 2.3.1's 25 % of a 10° field. */
export const BLINK_HZ = 2;

/** What a cheer `since` seconds ago looks like: the thumb's size and coverage, and the light. */
export type CheerLook = { thumb: number; alpha: number; lit: boolean };

const arrive = bezier(EASE.arrive);

/**
 * A cheer's moment: the thumb grows in, holds for the announce hold and
 * dithers out; the light blinks for CHEER_S. `steady` is reduced motion:
 * every motion a held stamp — the thumb at full size for its hold, the light
 * lit throughout. Null once it is over.
 */
export function cheerLook(since: number, steady: boolean): CheerLook | null {
	if (since < 0 || since >= CHEER_S) return null;
	const ms = since * 1000;
	const shown = ms < HOLD_ANNOUNCE + (steady ? 0 : DUR.quick);
	return {
		thumb: !shown ? 0 : steady ? 1 : arrive(Math.min(1, ms / DUR.base)),
		alpha:
			steady || ms < HOLD_ANNOUNCE
				? 1
				: Math.max(0, 1 - (ms - HOLD_ANNOUNCE) / DUR.quick),
		lit: steady || Math.floor(since * BLINK_HZ * 2) % 2 === 0,
	};
}

// docs/design/mockups/v3's thumbs-up, in its own 24-unit box (y down).
// ponytail: its two corner arcs drawn as straight cuts; a curve if anyone can tell at this size.
const CUFF = [
	[2, 10],
	[6, 10],
	[6, 21],
	[2, 21],
];
const HAND = [
	[8, 21],
	[17.5, 21],
	[19.5, 19.4],
	[20.9, 12.4],
	[19, 10],
	[13.5, 10],
	[14.3, 5.8],
	[12.3, 3.5],
	[8, 10],
];

/** The thumb on its disc, about a helmet wide: vertex colours, so one draw. The thumb sits on both faces. */
export function thumbGeometry(disc: THREE.Color, thumb: THREE.Color) {
	const R = 0.16;
	const s = (1.4 * R) / 24;
	const shape = (pts: number[][]) =>
		new THREE.Shape(
			pts.map(([x, y]) => new THREE.Vector2((x - 11.5) * s, (12.2 - y) * s)),
		);
	const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
		const n = g.getAttribute('position').count;
		g.setAttribute(
			'color',
			new THREE.Float32BufferAttribute(
				Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(),
				3,
			),
		);
		g.deleteAttribute('uv');
		g.deleteAttribute('normal');
		return g;
	};
	const hand = () =>
		new THREE.ShapeGeometry([shape(CUFF), shape(HAND)]).toNonIndexed();
	const parts = [
		paint(new THREE.CircleGeometry(R, 28).toNonIndexed(), disc),
		paint(hand().translate(0, 0, 0.006), thumb),
		paint(hand().translate(0, 0, -0.006), thumb),
	];
	const merged = mergeGeometries(parts)!;
	parts.forEach((g) => g.dispose());
	return merged;
}
