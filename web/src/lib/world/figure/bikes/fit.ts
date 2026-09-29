import { along, type BikeGeometry, type Pt } from './geometry';
import { BARS, type Cockpit } from './presets';

/**
 * The fit solver (#3069, ADR-0073): where a rider of a given height and
 * build sits on a frame — saddle, standing hips, bars and the named grips —
 * the way a bike fitter would set it, never measured off the rider.
 */

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));
const rot = (p: Pt, a: number): Pt => ({
	x: p.x * Math.cos(a) - p.y * Math.sin(a),
	y: p.x * Math.sin(a) + p.y * Math.cos(a),
});
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const polar = (a: number, r: number): Pt => ({
	x: Math.cos(a) * r,
	y: Math.sin(a) * r,
});

/** Knee flexion at bottom dead centre: where the saddle goes. */
export const FIT_KNEE_DEG = 35;
/** Standing never straightens the knee past this, over a whole revolution. */
export const STAND_KNEE_DEG = 20;
/** The share of the torso's forward lean the pelvis takes. */
export const PELVIS_TILT = 0.35;

export const BUILDS = { slim: 0.9, athletic: 1, strong: 1.12 } as const;
export type Build = keyof typeof BUILDS;
export const HEIGHT_M = { min: 1.5, max: 2.05, default: 1.8 } as const;

export type RiderDims = {
	height: number;
	/** Height over the 1.8 m the proportions are drawn at; the frame scales with it. */
	k: number;
	build: number;
	thigh: number;
	shin: number;
	torso: number;
	upperArm: number;
	foreArm: number;
	hipHalf: number;
	shoulderHalf: number;
	/** The pedal spindle in foot-local space: origin at the ankle. */
	cleat: Pt;
	/** The grip centre in hand-local space: origin at the wrist, inside the finger hook. */
	grip: Pt;
	/** The sit bones in pelvis-local space: origin at the hip joints. */
	sit: Pt;
};

export function riderDims(
	height: number = HEIGHT_M.default,
	build: Build = 'athletic',
): RiderDims {
	const h = clamp(
		Number.isFinite(height) ? height : HEIGHT_M.default,
		HEIGHT_M.min,
		HEIGHT_M.max,
	);
	const k = h / HEIGHT_M.default;
	const b = BUILDS[build];
	return {
		height: h,
		k,
		build: b,
		thigh: 0.44 * k,
		shin: 0.445 * k,
		torso: 0.5 * k,
		upperArm: 0.3 * k,
		foreArm: 0.255 * k,
		hipHalf: 0.087 * k * (0.96 + 0.04 * b),
		shoulderHalf: 0.18 * k * (0.93 + 0.07 * b),
		cleat: { x: 0.115 * k, y: -(0.075 * k + 0.012) },
		grip: { x: 0.068 * k, y: -0.04 * k },
		sit: { x: -0.03 * k, y: -0.092 * k },
	};
}

/** The pedal's toe-down angle, radians, at a crank angle from top dead centre: flattest early in the downstroke. */
export const toeDown = (theta: number): number =>
	(12 - 11 * Math.cos(theta - 75 * DEG)) * DEG;

/** Hip to ankle with the knee bent `flexDeg` from straight. */
export const kneeReach = (d: RiderDims, flexDeg: number): number =>
	Math.sqrt(
		d.thigh * d.thigh +
			d.shin * d.shin +
			2 * d.thigh * d.shin * Math.cos(flexDeg * DEG),
	);

/** How the right hand holds each grip: toward the knuckles, and out of the back of the hand. */
const HANDS = {
	hoods: { fwd: [1, 0.3, -0.06], up: [0, 0.88, 0.47] },
	drops: { fwd: [1, -0.32, 0.04], up: [0.1, 0.36, 0.93] },
	tops: { fwd: [0.25, -0.12, -1], up: [0.22, 0.97, 0.05] },
	aero: { fwd: [1, 0.22, -0.05], up: [0, 0.22, 1] },
	base: { fwd: [1, 0.06, 0], up: [0, 0.76, 0.65] },
	bend: { fwd: [1, 0.12, 0], up: [0, 0.86, 0.5] },
	upright: { fwd: [0.86, -0.34, 0.2], up: [0.22, 0.86, 0.46] },
} as const;
export type Hand = keyof typeof HANDS;

type V3 = [number, number, number];
const unit3 = (v: V3): V3 => {
	const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
	return [v[0] / n, v[1] / n, v[2] / n];
};

/** A hand's orthonormal frame on one side (1 right, −1 left): fwd, up and their cross product. */
export function handBasis(
	hand: Hand,
	side: 1 | -1,
): { fwd: V3; up: V3; out: V3 } {
	const h = HANDS[hand];
	const fwd = unit3([h.fwd[0], h.fwd[1], h.fwd[2] * side]);
	const u: V3 = [h.up[0], h.up[1], h.up[2] * side];
	const d = u[0] * fwd[0] + u[1] * fwd[1] + u[2] * fwd[2];
	const up = unit3([u[0] - d * fwd[0], u[1] - d * fwd[1], u[2] - d * fwd[2]]);
	const out: V3 = [
		fwd[1] * up[2] - fwd[2] * up[1],
		fwd[2] * up[0] - fwd[0] * up[2],
		fwd[0] * up[1] - fwd[1] * up[0],
	];
	return { fwd, up, out };
}

export type Grip = { p: V3; hand: Hand };
export type GripName = 'hoods' | 'drops' | 'tops' | 'extensions';
/** Right and left: the left mirrors the right across the bike's plane. */
export type Grips = Partial<Record<GripName, { R: Grip; L: Grip }>>;

export type Fit = {
	crank: number;
	pedalZ: number;
	/** Where the sit bones meet the saddle, and the hips seated and standing. */
	contact: Pt;
	hipSeat: Pt;
	hipStand: Pt;
	/** Saddle height up the seat tube from the bottom bracket. */
	saddleLen: number;
	steererTop: Pt;
	spacer: number;
	stem: number;
	stemDir: Pt;
	clampPt: Pt;
	grips: Grips;
	/** Time-trial only: the arm pads and the extension's elbow and wrist. */
	pad: Pt | null;
	ext: { elbow: Pt; wrist: Pt; dir: Pt } | null;
	/** Torso angle from horizontal, radians. */
	alpha: number;
};

const pair = (p: V3, hand: Hand) => ({
	R: { p, hand },
	L: { p: [p[0], p[1], -p[2]] as V3, hand },
});

export function fitRider(d: RiderDims, bk: BikeGeometry, cp: Cockpit): Fit {
	const style = cp.bar;
	// 170, 172.5 or 175 mm by height.
	const crank = 0.1725 * (d.k < 0.95 ? 0.986 : d.k > 1.05 ? 1.014 : 1);
	const pedalZ =
		(style === 'upright' ? 0.14 : 0.127) + Math.max(0, d.k - 1) * 0.04;

	// Saddle: knee at FIT_KNEE_DEG with the pedal at bottom dead centre.
	const ankle = sub(
		{ x: bk.bb.x, y: bk.bb.y - crank },
		rot(d.cleat, -toeDown(Math.PI)),
	);
	const alpha = cp.torsoDeg * DEG;
	const sit = rot(d.sit, -PELVIS_TILT * (Math.PI / 2 - alpha));
	const reach = kneeReach(d, FIT_KNEE_DEG);
	const q = sub(sub(bk.bb, sit), ankle);
	const bq = dot(q, bk.stDir);
	const cq = dot(q, q) - reach * reach;
	const saddleLen = -bq + Math.sqrt(Math.max(bq * bq - cq, 0));
	const contact = along(bk.bb, bk.stDir, saddleLen);
	const hipSeat = sub(contact, sit);

	// Standing: hips forward, as high as the knee allows over a revolution.
	const standX = hipSeat.x + (style === 'tt' ? 0.1 : 0.16) * d.k;
	const straightest = kneeReach(d, STAND_KNEE_DEG);
	let standY = Infinity;
	for (let i = 0; i < 72; i++) {
		const a = (i / 72) * 2 * Math.PI;
		const off = rot(d.cleat, -(toeDown(a + Math.PI / 2) + 8 * DEG));
		const an = sub(
			{ x: bk.bb.x + crank * Math.cos(a), y: bk.bb.y - crank * Math.sin(a) },
			off,
		);
		const dx = an.x - standX;
		standY = Math.min(
			standY,
			an.y + Math.sqrt(Math.max(straightest ** 2 - dx * dx, 0)),
		);
	}
	const hipStand = { x: standX, y: Math.min(standY, hipSeat.y + 0.07 * d.k) };

	// Cockpit: shoulders from the torso angle, hands from the arm angle, then
	// spacers and stem solved to put the bars there.
	const shoulder = add(hipSeat, polar(alpha, d.torso));
	const bar = BARS[style];
	let target: Pt;
	let pad: Pt | null = null;
	let ext: Fit['ext'] = null;
	if (style === 'tt') {
		const elbow = add(shoulder, polar(-78 * DEG, d.upperArm));
		const dir = polar(11 * DEG, 1);
		ext = { elbow, wrist: along(elbow, dir, d.foreArm), dir };
		pad = { x: elbow.x, y: elbow.y - 0.047 * d.k };
		// The base bar's clamp sits under the pads, on 7.5 cm risers.
		target = { x: pad.x - 0.03, y: pad.y - 0.075 };
	} else {
		const arm =
			Math.sqrt(
				d.upperArm ** 2 +
					d.foreArm ** 2 +
					2 * d.upperArm * d.foreArm * Math.cos(18 * DEG),
			) +
			0.055 * d.k;
		const hand = add(shoulder, polar(alpha - cp.shoulderDeg * DEG, arm));
		target = { x: hand.x - bar.hoods[0], y: hand.y - bar.hoods[1] };
	}
	const a = bk.up;
	const stemDir = rot(
		{ x: Math.sin(bk.hta), y: Math.cos(bk.hta) },
		cp.stemDeg * DEG,
	);
	const rhs = sub(target, bk.htTop);
	const det = a.x * stemDir.y - a.y * stemDir.x;
	const spacer = clamp(
		(rhs.x * stemDir.y - rhs.y * stemDir.x) / det,
		cp.spacer[0],
		cp.spacer[1],
	);
	const stem = clamp((a.x * rhs.y - a.y * rhs.x) / det, cp.stem[0], cp.stem[1]);
	const steererTop = along(bk.htTop, a, spacer);
	const clampPt = along(steererTop, stemDir, stem);

	const at = (o: V3): V3 => [clampPt.x + o[0], clampPt.y + o[1], o[2]];
	const grips: Grips = {};
	if (style === 'upright') grips.hoods = pair(at(bar.hoods), 'upright');
	else if (style === 'tt' && ext) {
		grips.hoods = pair(at(bar.hoods), 'base');
		grips.tops = pair(at(bar.tops), 'tops');
		const { fwd, up } = handBasis('aero', 1);
		grips.extensions = pair(
			[
				ext.wrist.x + fwd[0] * d.grip.x + up[0] * d.grip.y,
				ext.wrist.y + fwd[1] * d.grip.x + up[1] * d.grip.y,
				0.062,
			],
			'aero',
		);
	} else {
		grips.hoods = pair(at(bar.hoods), style === 'track' ? 'bend' : 'hoods');
		grips.drops = pair(at(bar.drops), 'drops');
		grips.tops = pair(at(bar.tops), 'tops');
	}

	return {
		crank,
		pedalZ,
		contact,
		hipSeat,
		hipStand,
		saddleLen,
		steererTop,
		spacer,
		stem,
		stemDir,
		clampPt,
		grips,
		pad,
		ext,
		alpha,
	};
}
