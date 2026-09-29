import { PELVIS_TILT, toeDown, type GripName } from './bikes/fit';
import { B } from './contract';
import type { Figure } from './figure';
import { chainQuats, circles, smin, T_, twoBone } from './ik';
import { _m, _q, _q2, poseFrame, S_, setBone } from './pose-frame';
import { clamp, lerp, sstep, X_, Y_, Z_ } from './math';

/**
 * The pose solver (#3071): the same state in, the same bone matrices out.
 * The root takes the road's full pitch and the bike its lean; sway rolls the
 * bike about the tyre's contact line and everything on it follows through
 * the hierarchy; two-bone IK puts the feet on the pedals and the hands on
 * their grips, and the torso swings about the hip until both hands are in
 * reach. The scratch vectors are shared, so a frame allocates next to
 * nothing.
 */

const DEG = Math.PI / 180;
const fin = (x: unknown, d: number) =>
	typeof x === 'number' && Number.isFinite(x) ? x : d;

export type Hold = { a: GripName; b: GripName; p: number };

export type PoseState = {
	crank?: number;
	wheel?: number;
	/** How far the wheels turned this frame: the spokes' motion blur (#3073). */
	wheelDelta?: number;
	stand?: number;
	swayAmp?: number;
	rockAmp?: number;
	lean?: number;
	pitch?: number;
	steer?: number;
	tuck?: number;
	/** Each hand moving from grip a to grip b, p of the way. */
	grip?: Partial<Record<'R' | 'L', Hold>>;
	elbow?: number;
	elbowOut?: number;
	torsoRoll?: number;
	yawAmp?: number;
	gaze?: number;
	nodAmp?: number;
	headYaw?: number;
	/** model.js's call shape (gate G21): the rock and the nod as the pose itself. */
	rock?: number;
	rockBody?: number;
	nod?: number;
};

export function pose(mesh: Figure, st: PoseState = {}): Figure {
	const { rig } = mesh.userData;
	const bones = mesh.skeleton.bones;
	const { dims: d, bk, fit } = rig;
	const k = d.k;
	const crank = fin(st.crank, 0);
	const wheel = fin(st.wheel, 0);
	const s = clamp(fin(st.stand, 0), 0, 1);
	// model.js passed the rock and the body's rock directly (G21).
	const compat = st.swayAmp === undefined && st.rock !== undefined;
	const swayAmp = clamp(compat ? s * 0.12 : fin(st.swayAmp, 0), 0, 0.2);
	const rockAmp = clamp(
		fin(st.rockAmp, compat ? fin(st.rockBody, 0.02) : 0.02),
		0,
		0.1,
	);
	const thR = crank + Math.PI / 2; // the right crank from top dead centre
	const sway = -swayAmp * Math.sin(thR - 50 * DEG);
	const lean = clamp(fin(st.lean, 0), -0.7, 0.7);
	const pitch = clamp(fin(st.pitch, 0), -0.4, 0.4);
	const steer = clamp(fin(st.steer, 0), -0.7, 0.7);
	const tuck = clamp(fin(st.tuck, 0), 0, 1);
	const rt = bk.rt;
	poseFrame(bones, bk, { pitch, lean, sway, steer, crank, wheel });
	// Hips: seated to standing, a little bob with the pedal stroke, and the sway carried up the body.
	const hip = S_.hip.copy(fit.hipSeat).lerp(fit.hipStand, s);
	hip.y += s * -0.012 * k * Math.cos(2 * (thR - 140 * DEG));
	hip.x += tuck * 0.012 * k;
	hip.z = lerp(1, 0.5, s) * (hip.y - rt) * Math.sin(sway);
	// Grips to wrists. The hands ride the fork, so steering carries them.
	let wA = 0;
	const gripOf = (side: 'R' | 'L') => {
		const gs = st.grip?.[side] ?? { a: 'hoods', b: 'hoods', p: 1 };
		const ga = fit.grips[gs.a] ? gs.a : 'hoods';
		const gb = fit.grips[gs.b] ? gs.b : 'hoods';
		const p = clamp(fin(gs.p, 1), 0, 1);
		const e = sstep(0, 1, p);
		const A = fit.grips[ga]![side];
		const Bg = fit.grips[gb]![side];
		const pos = (side === 'R' ? S_.gR : S_.gL).copy(A.p).lerp(Bg.p, e);
		// A lift arc: off and back down with zero speed, so a grip change starts without a pop.
		const arc = Math.sin(Math.PI * p) ** 2;
		pos.y += arc * 0.045 * k;
		pos.x -= arc * 0.012 * k;
		const q = (side === 'R' ? S_.qR : S_.qL).copy(A.q).slerp(Bg.q, e);
		wA += (ga === 'extensions' ? 1 - e : 0) + (gb === 'extensions' ? e : 0);
		pos.applyMatrix4(S_.forkM);
		q.premultiply(S_.forkQ);
		const grip = T_.a.set(d.grip.x, d.grip.y, 0).applyQuaternion(q);
		return (side === 'R' ? S_.wR : S_.wL).copy(pos).sub(grip);
	};
	const wR = gripOf('R');
	const wL = gripOf('L');
	wA *= 0.5;
	// Shoulders: the torso swings about the hip until the arms reach the wrists at the elbow bend asked for.
	const T = d.torso;
	const u = d.upperArm;
	const f = d.foreArm;
	const e = clamp(fin(st.elbow, 20), 0, 110) * DEG;
	const Dw = Math.sqrt(u * u + f * f + 2 * u * f * Math.cos(e));
	const dz =
		(Math.abs(wR.z - hip.z) + Math.abs(wL.z - hip.z)) / 2 - d.shoulderHalf;
	const Wm = S_.s1.addVectors(wR, wL).multiplyScalar(0.5);
	const sh = circles(
		hip,
		T,
		Wm,
		Math.sqrt(Math.max(Dw * Dw - dz * dz, 0.0025)),
		S_.sh,
	);
	if (wA > 0 && fit.ext) {
		const el = S_.el.copy(fit.ext.elbow).applyMatrix4(S_.forkM);
		const dzE = 0.1 * k - d.shoulderHalf;
		sh.lerp(
			circles(
				hip,
				T,
				el,
				Math.sqrt(Math.max(u * u - dzE * dzE, 0.0025)),
				S_.s2,
			),
			wA,
		);
	}
	// Both hands stay in reach (a grip change half done, steering, deep drops): the torso's angle
	// on the hip circle may not pass the highest one each wrist can still be reached from — a smooth
	// minimum, so the torso eases into the limit.
	let ang = Math.atan2(sh.y - hip.y, sh.x - hip.x);
	for (const w of [wR, wL]) {
		const reach = u + f - 0.012;
		const dzs = Math.max(Math.abs(w.z - hip.z) - d.shoulderHalf, 0);
		const lim = circles(
			hip,
			T,
			w,
			Math.sqrt(Math.max(reach * reach - dzs * dzs, 0.0025)),
			S_.s2,
		);
		ang = smin(ang, Math.atan2(lim.y - hip.y, lim.x - hip.x), 0.03);
	}
	sh.set(hip.x + Math.cos(ang) * T, hip.y + Math.sin(ang) * T, hip.z * 0.6);
	const Yt = S_.ty.subVectors(sh, hip).normalize();
	const torsoRoll = fin(st.torsoRoll, 0) + sway * 0.4 * s;
	const Z0 = S_.tz.set(0, -Math.sin(torsoRoll), Math.cos(torsoRoll));
	const Xt = S_.tx.crossVectors(Yt, Z0).normalize();
	Z0.crossVectors(Xt, Yt);
	const yaw =
		clamp(fin(st.yawAmp, 0), 0, 0.15) * Math.sin(thR - 90 * DEG) - steer * 0.6;
	S_.tq
		.setFromRotationMatrix(_m.makeBasis(Xt, Yt, Z0))
		.premultiply(_q.setFromAxisAngle(Yt, yaw));
	setBone(bones, B.torso, hip, S_.tq);
	const Xw = S_.xw.set(1, 0, 0).applyQuaternion(S_.tq);
	const Zw = S_.zw.set(0, 0, 1).applyQuaternion(S_.tq);
	// Pelvis: takes part of the torso's forward lean, and rocks toward the downstroke.
	const alpha = Math.atan2(Yt.y, Yt.x);
	const tilt = PELVIS_TILT * (Math.PI / 2 - alpha);
	const roll = rockAmp * Math.sin(thR - 100 * DEG);
	const pyaw = rockAmp * 0.6 * Math.sin(thR - 90 * DEG);
	S_.pq
		.setFromAxisAngle(Y_, pyaw - steer * 0.25)
		.multiply(_q.setFromAxisAngle(X_, roll + sway * (1 - 0.5 * s)))
		.multiply(_q2.setFromAxisAngle(Z_, -tilt));
	setBone(bones, B.pelvis, hip, S_.pq);
	// Legs: the ankle is the pedal minus the cleat, turned by the foot's toe-down.
	for (const [side, th, shn, ft, phase] of [
		[1, B.thighR, B.shinR, B.footR, 0],
		[-1, B.thighL, B.shinL, B.footL, Math.PI],
	]) {
		const theta = crank + phase + Math.PI / 2;
		const sp = S_.sp
			.set(side * fit.crank, 0, side * fit.pedalZ)
			.applyMatrix4(S_.crankM);
		const td = toeDown(theta) + s * 8 * DEG - tuck * 4 * DEG;
		const fq = S_.qf.copy(S_.bikeQ).multiply(_q.setFromAxisAngle(Z_, -td));
		const ankle = S_.ankle
			.set(d.cleat.x, d.cleat.y, 0)
			.applyQuaternion(fq)
			.negate()
			.add(sp);
		const hj = S_.hj
			.set(0, 0, side * d.hipHalf)
			.applyQuaternion(S_.pq)
			.add(hip);
		const splay =
			0.08 +
			Math.max(0, sway * side) -
			0.09 * tuck +
			0.03 * Math.sin(2 * theta - Math.PI / 2);
		const pole = S_.pole.set(1, 0, side * splay).normalize();
		const knee = twoBone(hj, ankle, d.thigh, d.shin, pole, S_.knee, S_.bend);
		chainQuats(hj, knee, ankle, S_.bend, S_.qa, S_.qb);
		setBone(bones, th, hj, S_.qa);
		setBone(bones, shn, knee, S_.qb);
		setBone(bones, ft, ankle, fq);
	}
	// Arms, and the hands on their grips.
	const out = clamp(fin(st.elbowOut, 0), 0, 1);
	for (const [side, up, fo, hb, w, q] of [
		[1, B.armR, B.foreR, B.handR, wR, S_.qR],
		[-1, B.armL, B.foreL, B.handL, wL, S_.qL],
	] as const) {
		const shJ = S_.s2
			.copy(sh)
			.addScaledVector(Zw, side * d.shoulderHalf)
			.addScaledVector(Yt, -0.012 * k);
		// The shoulder blade slides toward a far hand (up to 6 cm) before the elbow would lock.
		const keep = Math.sqrt(u * u + f * f + 2 * u * f * Math.cos(10 * DEG));
		const far = shJ.distanceTo(w) - keep;
		if (far > 0)
			shJ.addScaledVector(
				T_.a.subVectors(w, shJ).normalize(),
				Math.min(far, 0.06 * k),
			);
		const pole = S_.pole
			.copy(Xw)
			.multiplyScalar(-0.2)
			.add(T_.b.set(-0.3, -0.75 - 0.25 * tuck, 0))
			.addScaledVector(Zw, side * lerp(0.5, 0.85, out) * (1 - 0.55 * tuck));
		if (wA > 0 && fit.ext) {
			const el = S_.el
				.copy(fit.ext.elbow)
				.setZ(side * 0.1 * k)
				.applyMatrix4(S_.forkM);
			const mid = S_.mid.addVectors(shJ, w).multiplyScalar(0.5);
			pole.lerp(el.sub(mid).normalize(), wA);
		}
		const elbow = twoBone(shJ, w, u, f, pole, S_.elbow, S_.bend);
		chainQuats(shJ, elbow, w, S_.bend, S_.qa, S_.qb);
		setBone(bones, up, shJ, S_.qa);
		setBone(bones, fo, elbow, S_.qb);
		setBone(bones, hb, w, q);
	}
	// Head: a level-seeking gaze against the road's pitch, counter-rolling the shoulders.
	const neck = S_.neck
		.copy(sh)
		.addScaledVector(Yt, 0.035 * k)
		.addScaledVector(Xw, -0.012 * k);
	const gaze = clamp(fin(st.gaze, -8), -40, 20) * DEG - pitch;
	const nod = fin(st.nodAmp, 0) * Math.sin(2 * crank) + fin(st.nod, 0);
	_q.setFromAxisAngle(Y_, clamp(fin(st.headYaw, 0), -0.8, 0.8))
		.multiply(_q2.setFromAxisAngle(Z_, gaze + nod))
		.multiply(S_.qa.setFromAxisAngle(X_, -torsoRoll * 0.8));
	setBone(bones, B.head, neck, _q);
	// How far the wheels turned this frame, for the spokes' blur: a caller without an animator gets the per-call sweep.
	const wd =
		typeof st.wheelDelta === 'number'
			? st.wheelDelta
			: Math.abs(wheel - fin(mesh.userData.lastWheel, wheel));
	mesh.userData.lastWheel = wheel;
	mesh.userData.wheelDelta = clamp(Math.abs(fin(wd, 0)), 0, 20);
	return mesh;
}
