import {
	ANIM,
	DEG,
	fin,
	mulberry,
	type Posture,
	sp0,
	spring,
} from './anim-params';
import { Behaviour } from './behaviour';
import { effortRpm } from './cadence';
import { CrankMotion } from './crank-motion';
import type { Figure } from './figure';
import { clamp, TAU } from './math';
import type { PoseState } from './pose';
import type { Rig } from './rig';

/**
 * The posture animator (#3071): ride data in, a pose state out, once a
 * frame. The legs move only when the data says so, and never backwards;
 * everything continuous is a critically damped spring, so a jump in the data
 * is never a jump on screen.
 */

export type RideInput = {
	power?: number;
	/** rpm; absent when the trainer reports none. */
	cadence?: number;
	ftp?: number;
	/** m/s */
	speed?: number;
	/** % */
	grade?: number;
	/** 1/m, positive turning right */
	curvature?: number;
	/** A sprint moment is armed. */
	sprint?: boolean;
	reducedMotion?: boolean;
};

export type AnimState = PoseState & {
	crank: number;
	wheel: number;
	posture: Posture;
	cadence: number;
	mode: CrankMotion['mode'];
	pedalling: boolean;
};

const SPRINGS = [
	'stand',
	'elbow',
	'gaze',
	'sway',
	'rock',
	'tuck',
	'lean',
	'steer',
	'pitch',
	'yaw',
	'look',
	'out',
] as const;

export class RiderAnimator {
	readonly state = {} as AnimState;
	private readonly rig: Rig;
	private readonly remote: boolean;
	private readonly reduced: boolean;
	private readonly rand: () => number;
	private readonly legs: CrankMotion;
	private readonly mind: Behaviour;
	private readonly sp = Object.fromEntries(
		SPRINGS.map((k) => [k, sp0()]),
	) as Record<(typeof SPRINGS)[number], ReturnType<typeof sp0>>;
	private wheel = 0;
	private t = 0;
	private rFast = 0;
	private rSlow = 0;
	private vS = 0;
	private gS = 0;
	private pedalling = false;
	private pedalT = 0;
	private cadGoal = 0;
	private lookNext: number;
	private lookUntil = -1;
	private lookDir = 0;

	constructor(
		mesh: Figure,
		opts: {
			seed?: number;
			remote?: boolean;
			reducedMotion?: boolean;
			crank?: number;
		} = {},
	) {
		this.rig = mesh.userData.rig;
		this.remote = !!opts.remote;
		this.reduced = !!opts.reducedMotion;
		this.rand = mulberry((opts.seed ?? 1) >>> 0);
		this.legs = new CrankMotion(fin(opts.crank, 0));
		this.mind = new Behaviour(this.rig, this.rand);
		this.sp.elbow.x = ANIM.elbow.stopped;
		this.sp.gaze.x = ANIM.gaze.stopped;
		this.lookNext = 8 + this.rand() * 12;
		this.update(0, {});
	}

	update(dtIn: number, inp: RideInput = {}): AnimState {
		const A = ANIM;
		const dt = clamp(fin(dtIn, 0), 0, 1);
		this.t += dt;
		const { rig, sp, mind } = this;
		const ftp = fin(inp.ftp, 0) > 30 ? (inp.ftp as number) : 250;
		const power = clamp(fin(inp.power, 0), 0, 3000);
		const speed = clamp(fin(inp.speed, 0), 0, 40);
		const grade = clamp(fin(inp.grade, 0), -30, 30);
		const kappa = clamp(fin(inp.curvature, 0), -0.25, 0.25);
		const reduced = this.reduced || !!inp.reducedMotion;
		const raw = cadenceTarget(fin(inp.cadence, Number.NaN), power, ftp);
		if (raw > 0) this.cadGoal = raw;
		this.pedalT = raw > 0 !== this.pedalling ? this.pedalT + dt : 0;
		if (this.pedalT >= A.pedalHold) {
			this.pedalling = raw > 0;
			this.pedalT = 0;
		}
		const pedalling = this.pedalling;
		const target = pedalling ? this.cadGoal : 0;
		const hlCad = this.remote ? A.halfLife.cadenceRemote : A.halfLife.cadence;
		this.legs.step(target, hlCad, sp.lean.x, dt);
		const wheelDelta = (speed / rig.bk.R) * dt;
		this.wheel = (this.wheel + wheelDelta) % (TAU * 1000);
		// Effort, speed and grade, smoothed: decisions never read one noisy sample.
		const r = power / ftp;
		this.rFast += (r - this.rFast) * (1 - Math.exp(-dt / 0.8));
		this.rSlow += (r - this.rSlow) * (1 - Math.exp(-dt / 3));
		this.vS += (speed - this.vS) * (1 - Math.exp(-dt / 1));
		this.gS += (grade - this.gS) * (1 - Math.exp(-dt / 1.5));
		// prettier-ignore
		mind.step({ t: this.t, dt, pedalling, rpm: this.legs.rpm, armed: inp.sprint === true, rFast: this.rFast, rSlow: this.rSlow, vS: this.vS, gS: this.gS, crank: this.legs.crank, lean: sp.lean.x, stand: sp.stand.x });
		const P = mind.posture;
		const grip = mind.hands.R.b;
		const stood = mind.standGoal === 1;
		// prettier-ignore
		const elbowGoal = P === 'tuck' ? A.elbow.tuck : P === 'sprint' ? A.elbow.sprint : P === 'climb' || P === 'stretch' ? A.elbow.climb : P === 'coast' || P === 'stopped' ? Math.max(A.elbow[P], A.elbow[grip] - 2) : A.elbow[grip];
		const swayStand =
			(P === 'sprint'
				? A.swayDeg.sprint * clamp(this.rFast / A.sprint.enterR, 0.7, 1.15)
				: A.swayDeg.climb * clamp(this.rSlow, 0.6, 1.3)) *
			DEG *
			(rig.style === 'upright' ? 0.55 : 1);
		const swaySeat = pedalling ? A.swayDeg.seated * clamp(r, 0, 1.2) * DEG : 0;
		const rock = stood
			? A.rockDeg.stand
			: A.rockDeg.seated * clamp(r, 0.3, 1.2);
		const leanMax = pedalling ? rig.leanMax.pedal : rig.leanMax.coast;
		// Looking around: seeded, and only when relaxed.
		if (this.t >= this.lookNext) {
			this.lookNext = this.t + 8 + this.rand() * 12;
			if (
				(P === 'seated' || P === 'coast') &&
				Math.abs(sp.lean.x) < 5 * DEG &&
				!reduced
			) {
				this.lookUntil = this.t + 1.2;
				this.lookDir = this.rand() < 0.5 ? -1 : 1;
			}
		}
		const hl = A.halfLife;
		spring(sp.stand, mind.standGoal, hl.stand, dt);
		spring(sp.elbow, elbowGoal, hl.elbow, dt);
		spring(sp.gaze, A.gaze[P === 'stretch' ? 'climb' : P], hl.gaze, dt);
		spring(sp.sway, reduced ? 0 : stood ? swayStand : swaySeat, hl.sway, dt);
		spring(sp.rock, reduced || !pedalling ? 0 : rock * DEG, hl.rock, dt);
		spring(sp.tuck, P === 'tuck' ? 1 : 0, hl.tuck, dt);
		spring(
			sp.lean,
			clamp(Math.atan((speed * speed * kappa) / 9.81), -leanMax, leanMax),
			hl.lean,
			dt,
		);
		spring(
			sp.steer,
			clamp(Math.atan(rig.bk.wheelbase * kappa), -0.6, 0.6),
			hl.steer,
			dt,
		);
		spring(sp.pitch, Math.atan(grade / 100), hl.pitch, dt);
		spring(sp.yaw, !reduced && P === 'sprint' ? 5 * DEG : 0, hl.rock, dt);
		spring(
			sp.look,
			this.t < this.lookUntil ? this.lookDir * 0.35 : 0,
			hl.look,
			dt,
		);
		spring(sp.out, P === 'sprint' ? 1 : 0, hl.elbow, dt);
		const st = this.state;
		st.crank = this.legs.crank;
		st.wheel = this.wheel;
		st.wheelDelta = wheelDelta;
		st.stand = clamp(sp.stand.x, 0, 1);
		st.swayAmp = Math.max(0, sp.sway.x);
		st.rockAmp = Math.max(0, sp.rock.x);
		st.elbow = sp.elbow.x;
		st.gaze = sp.gaze.x;
		st.tuck = clamp(sp.tuck.x, 0, 1);
		// The pedalling clamp holds while the cadence spins up; the coasting one is the hard limit.
		st.lean = clamp(sp.lean.x, -rig.leanMax.coast, rig.leanMax.coast);
		st.steer = sp.steer.x;
		st.pitch = sp.pitch.x;
		st.yawAmp = Math.max(0, sp.yaw.x);
		st.headYaw = sp.look.x;
		st.nodAmp = reduced ? 0 : 0.012 * clamp(r, 0, 1.4);
		st.elbowOut = clamp(sp.out.x, 0, 1);
		st.grip = { R: { ...mind.hands.R }, L: { ...mind.hands.L } };
		st.posture = P;
		st.cadence = this.legs.rpm;
		st.mode = this.legs.mode;
		st.pedalling = pedalling;
		return st;
	}
}

/** rpm the legs should turn at: the trainer's own cadence, else SPEC's effort tiers, else none — stopped. */
export function cadenceTarget(
	cadence: number,
	power: number,
	ftp: number,
): number {
	const A = ANIM;
	if (Number.isFinite(cadence) && cadence >= A.stopped.cadence)
		return Math.min(cadence, A.maxRpm);
	return power >= A.stopped.power ? effortRpm(power, ftp) : 0;
}
