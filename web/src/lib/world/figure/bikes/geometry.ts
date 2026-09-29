import type { FrameGeometry } from './presets';

/**
 * A frame's points from its geometry (#3069): the bike's own plane, x forward
 * from the bottom bracket, y up from the ground, metres. Built the way a
 * frame is specified — stack and reach from the bottom bracket, the steering
 * axis from the head angle, the axle from the fork's offset — so gate G20
 * can read every number back exactly.
 */

export type Pt = { x: number; y: number };

const DEG = Math.PI / 180;

export const along = (p: Pt, dir: Pt, t: number): Pt => ({
	x: p.x + dir.x * t,
	y: p.y + dir.y * t,
});

/** ISO 622 bead seat, metres: a road rim before its tyre. */
export const BEAD_SEAT_M = 0.311;

/** Wheel radius: the bead seat plus the tyre's height, 0.95 of its width. */
export const wheelRadius = (tyreMm: number): number =>
	BEAD_SEAT_M + 0.95 * (tyreMm / 1000);

export type BikeGeometry = {
	/** Wheel radius, and the tyre's tube radius as drawn. */
	R: number;
	tube: number;
	bb: Pt;
	rear: Pt;
	front: Pt;
	/** Top and bottom of the head tube, on the steering axis. */
	htTop: Pt;
	htBot: Pt;
	/** Unit vectors down and up the steering axis. */
	down: Pt;
	up: Pt;
	/** Head and seat angle, radians. */
	hta: number;
	sta: number;
	/** Unit vector up the seat tube. */
	stDir: Pt;
	/** Where the top tube meets the seat tube, and how far up the seat tube that is. */
	cluster: Pt;
	clusterLen: number;
	ttFront: Pt;
	dtFront: Pt;
	/** The frame's scale: it follows the rider's height, the wheels do not. */
	size: number;
	wheelbase: number;
};

export function bikeGeometry(
	g: FrameGeometry,
	tyreMm: number,
	size = 1,
): BikeGeometry {
	const R = wheelRadius(tyreMm);
	const drop = g.bbDrop / 1000;
	const cs = g.chainstay / 1000;
	const bb = { x: 0, y: R - drop };
	const rear = { x: -Math.sqrt(cs * cs - drop * drop), y: R };
	const hta = g.hta * DEG;
	const sta = g.sta * DEG;
	const htTop = {
		x: (g.reach / 1000) * size,
		y: bb.y + (g.stack / 1000) * size,
	};
	const down = { x: Math.cos(hta), y: -Math.sin(hta) };
	const htBot = along(htTop, down, (g.headTube / 1000) * size);
	// Down the axis to axle height, then forward by the offset measured square to it.
	const toAxle = (htTop.y - R) / Math.sin(hta);
	const front = {
		x: htTop.x + toAxle * down.x + g.forkOffset / 1000 / Math.sin(hta),
		y: R,
	};
	const stDir = { x: -Math.cos(sta), y: Math.sin(sta) };
	const ttFront = along(htTop, down, (g.ttDrop ?? 24) / 1000);
	const clusterLen =
		g.topTube === 'level'
			? (ttFront.y - bb.y) / Math.sin(sta)
			: (g.seatTube / 1000) * size;
	return {
		R,
		tube: (tyreMm / 1000) * 0.56,
		bb,
		rear,
		front,
		htTop,
		htBot,
		down,
		up: { x: -down.x, y: -down.y },
		hta,
		sta,
		stDir,
		cluster: along(bb, stDir, clusterLen),
		clusterLen,
		ttFront,
		dtFront: along(htBot, down, -0.032),
		size,
		wheelbase: front.x - rear.x,
	};
}
