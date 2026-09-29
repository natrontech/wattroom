import { ANIM, DEG, type Posture } from './anim-params';
import type { GripName } from './bikes/fit';
import { clamp } from './math';
import type { Hold } from './pose';
import type { Rig } from './rig';

/** What the behaviour reads each frame, smoothed where a decision would otherwise follow one noisy sample. */
export type Reading = {
	t: number;
	dt: number;
	pedalling: boolean;
	rpm: number;
	armed: boolean;
	rFast: number;
	rSlow: number;
	/** m/s, smoothed */
	vS: number;
	/** %, smoothed */
	gS: number;
	crank: number;
	lean: number;
	stand: number;
};

type Hand = Hold & { delay: number; dur: number };

/**
 * The rider's decisions (#3071): postures with hysteresis and a dwell,
 * standing up and sitting down timed to the crank, grips that change after a
 * dwell and one hand after the other.
 */
export class Behaviour {
	posture: Posture = 'stopped';
	standGoal = 0;
	readonly hands: Record<'R' | 'L', Hand> = {
		R: { a: 'hoods', b: 'hoods', p: 1, delay: 0, dur: ANIM.gripMove },
		L: { a: 'hoods', b: 'hoods', p: 1, delay: 0, dur: ANIM.gripMove },
	};
	private postureT = 99;
	private climbT = 0;
	private coastT = 0;
	private gripGoal: GripName = 'hoods';
	private gripT = 99;
	private stretchNext: number;
	private stretchUntil = -1;

	constructor(
		private readonly rig: Rig,
		private readonly rand: () => number,
	) {
		const [lo, hi] = ANIM.stretch.every;
		this.stretchNext = lo + rand() * (hi - lo);
	}

	step(r: Reading): void {
		this.choosePosture(r);
		this.timeStand(r);
		this.chooseGrips(r);
	}

	private choosePosture(r: Reading): void {
		const A = ANIM;
		this.postureT += r.dt;
		this.coastT = r.pedalling ? 0 : this.coastT + r.dt;
		const { gS, rpm } = r;
		const kmhS = r.vS * 3.6;
		const inClimb =
			gS >= A.climb.grade && rpm < A.climb.cadBelow && r.rSlow >= A.climb.r;
		this.climbT = r.pedalling && inClimb ? this.climbT + r.dt : 0;
		const P = this.posture;
		let next = P;
		if (!r.pedalling) {
			if (r.vS < 0.4) next = 'stopped';
			else if (P === 'tuck')
				next =
					kmhS >= A.tuck.exitKmh || this.postureT < A.tuck.dwell
						? 'tuck'
						: 'coast';
			else
				next =
					kmhS >= A.tuck.kmh &&
					gS <= A.tuck.grade &&
					this.coastT >= A.tuck.after
						? 'tuck'
						: 'coast';
		} else {
			const sprintEnter =
				rpm >= A.sprint.minCad &&
				(r.rFast >= A.sprint.enterR ||
					(r.armed && r.rFast >= A.sprint.enterArmedR));
			const sprintStay =
				rpm >= A.sprint.minCad - 10 &&
				(r.rFast >= A.sprint.exitR ||
					(r.armed && r.rFast >= A.sprint.exitArmedR));
			const climbStay = !(
				rpm > A.climb.exitCad ||
				gS < A.climb.exitGrade ||
				r.rSlow < A.climb.exitR
			);
			if (P === 'sprint')
				next =
					sprintStay || this.postureT < A.sprint.dwell
						? 'sprint'
						: climbStay && gS >= A.climb.grade
							? 'climb'
							: 'seated';
			else if (P === 'climb')
				next = sprintEnter
					? 'sprint'
					: climbStay || this.postureT < A.climb.dwell
						? 'climb'
						: 'seated';
			else if (P === 'stretch')
				next = sprintEnter
					? 'sprint'
					: (r.t < this.stretchUntil && gS >= A.climb.grade) ||
						  this.postureT < 3
						? 'stretch'
						: 'seated';
			else
				next = sprintEnter
					? 'sprint'
					: this.climbT >= A.climb.hold
						? 'climb'
						: 'seated';
			if (
				next === 'seated' &&
				gS >= A.climb.grade &&
				r.t >= this.stretchNext &&
				this.postureT > 20
			) {
				const [lo, hi] = A.stretch.lasts;
				const [e0, e1] = A.stretch.every;
				next = 'stretch';
				this.stretchUntil = r.t + lo + this.rand() * (hi - lo);
				this.stretchNext = r.t + e0 + this.rand() * (e1 - e0);
			}
		}
		if (next !== P && this.postureT >= A.postureFloor) {
			this.posture = next;
			this.postureT = 0;
		}
	}

	/** Rise with the lead crank 20–60° past the top; sit down at 160–200°. On a TT bike the hands leave the extensions first. */
	private timeStand(r: Reading): void {
		const A = ANIM;
		const P = this.posture;
		const want =
			r.pedalling && (P === 'sprint' || P === 'climb' || P === 'stretch');
		const ph =
			((((r.crank + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) / DEG;
		const { R, L } = this.hands;
		const handsReady =
			this.rig.style !== 'tt' || (R.p >= 1 && L.p >= 1 && R.b !== 'extensions');
		const [s0, s1] = A.standWindow;
		const [d0, d1] = A.sitWindow;
		if (want && handsReady && this.standGoal === 0 && ph >= s0 && ph <= s1)
			this.standGoal = 1;
		if (
			!want &&
			this.standGoal === 1 &&
			(!r.pedalling || ph >= d0 || ph <= d1 - 180)
		)
			this.standGoal = 0;
	}

	/** Grips: forced at once by a sprint or a tuck; every other change waits out the dwell. */
	private chooseGrips(r: Reading): void {
		const A = ANIM;
		const { rig } = this;
		const P = this.posture;
		const kmhS = r.vS * 3.6;
		let goal: GripName = this.gripGoal;
		let forced = false;
		this.gripT += r.dt;
		if (rig.style === 'upright') goal = 'hoods';
		else if (rig.style === 'tt') {
			// On the extensions seated or coasting at speed; the base bar to stand, corner, climb steep or roll slowly.
			const aero =
				(P === 'seated' || P === 'coast' || P === 'tuck') &&
				r.stand < 0.2 &&
				r.gS <= 6 &&
				Math.abs(r.lean) < 8 * DEG &&
				kmhS > 15;
			goal = aero ? 'extensions' : 'hoods';
			forced =
				!aero &&
				(P === 'sprint' || P === 'climb' || Math.abs(r.lean) >= 8 * DEG);
		} else if (P === 'sprint' || P === 'tuck') {
			forced = true;
			goal = 'drops';
		} else if (P === 'seated') {
			const wantDrops = kmhS >= A.drops.kmh || r.rSlow >= A.drops.r;
			const keepDrops = kmhS >= A.drops.exitKmh || r.rSlow >= A.drops.exitR;
			const wantTops = r.gS >= A.tops.grade && r.rSlow < A.tops.r;
			const keepTops = r.gS >= A.tops.exitGrade && r.rSlow <= A.tops.exitR;
			if (this.gripGoal === 'drops' && keepDrops) goal = 'drops';
			else if (this.gripGoal === 'tops' && keepTops && !wantDrops)
				goal = 'tops';
			else goal = wantDrops ? 'drops' : wantTops ? 'tops' : 'hoods';
		} else
			goal =
				P === 'coast' && this.gripGoal === 'drops' && kmhS > 35
					? 'drops'
					: 'hoods';
		if (!rig.fit.grips[goal]) goal = 'hoods';
		if (goal !== this.gripGoal && !forced && this.gripT < A.gripDwell)
			goal = this.gripGoal;
		const { R, L } = this.hands;
		if (goal !== this.gripGoal && R.p >= 1 && L.p >= 1) {
			// Hands travel at a steady ~0.7 m/s: a short hop is quick, pads to base bar takes longer.
			const from = rig.fit.grips[R.b]?.R;
			const to = rig.fit.grips[goal]?.R;
			const aero = goal === 'extensions' || R.b === 'extensions';
			const dur =
				from && to
					? clamp(
							Math.max(
								from.p.distanceTo(to.p) / 0.7 + 0.12,
								from.q.angleTo(to.q) / 4 + 0.1,
								aero ? 0.5 : 0,
							),
							A.gripMove,
							0.6,
						)
					: A.gripMove;
			this.gripGoal = goal;
			this.gripT = 0;
			this.hands.R = { a: R.b, b: goal, p: 0, delay: 0, dur };
			this.hands.L = { a: L.b, b: goal, p: 0, delay: A.gripStagger, dur };
		}
		for (const h of [this.hands.R, this.hands.L]) {
			if (h.p >= 1) continue;
			if (h.delay > 0) {
				h.delay -= r.dt;
				if (h.delay > 0) continue;
				h.p += -h.delay / h.dur;
				h.delay = 0;
			} else h.p += r.dt / h.dur;
			if (h.p >= 1) {
				h.p = 1;
				h.a = h.b;
			}
		}
	}
}
