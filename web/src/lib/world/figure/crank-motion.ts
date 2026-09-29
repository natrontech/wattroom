import { ANIM, DEG, sp0, spring } from './anim-params';
import { clamp, TAU } from './math';

/**
 * The legs (#3071): pedal at a sprung cadence while there is one; when it
 * stops, settle forward to a level crank — the inside one up in a bend —
 * within SPEC's 1.2 s, or stop softly where they are. Never backwards.
 */
export class CrankMotion {
	crank: number;
	mode: 'pedal' | 'settle' | 'hold' = 'hold';
	private cad = sp0();
	private settle: {
		a0: number;
		d: number;
		v0: number;
		T: number;
		t: number;
	} | null = null;

	constructor(crank = 0) {
		this.crank = crank;
	}

	/** rpm the legs are turning at now. */
	get rpm(): number {
		return this.mode === 'pedal' ? this.cad.x : 0;
	}

	private get omega(): number {
		if (this.mode === 'pedal') return (this.cad.x * TAU) / 60;
		const S = this.settle;
		return S ? S.v0 * (1 - Math.min(S.t / S.T, 1)) : 0;
	}

	step(target: number, hl: number, lean: number, dt: number): void {
		if (target > 0) {
			if (this.mode !== 'pedal') {
				this.cad.x = (this.omega * 60) / TAU;
				this.cad.v = 0;
				this.mode = 'pedal';
				this.settle = null;
			}
			spring(this.cad, target, hl, dt);
			this.cad.x = clamp(this.cad.x, 0, ANIM.maxRpm);
			this.crank += (this.cad.x / 60) * TAU * dt;
		} else {
			if (this.mode === 'pedal') this.beginSettle(lean);
			const S = this.settle;
			if (S) {
				S.t += dt;
				const x = Math.min(S.t / S.T, 1);
				this.crank = S.a0 + S.d * (2 * x - x * x); // constant deceleration to rest
				if (x >= 1) {
					this.crank = S.a0 + S.d;
					this.mode = 'hold';
					this.settle = null;
				}
			}
		}
		if (this.crank > 1e4) {
			const w = Math.floor(this.crank / TAU) * TAU;
			this.crank -= w;
			if (this.settle) this.settle.a0 -= w;
		}
	}

	private beginSettle(lean: number): void {
		const v0 = (this.cad.x * TAU) / 60;
		this.cad.x = 0;
		this.cad.v = 0;
		if (v0 < 0.05) {
			this.mode = 'hold';
			return;
		}
		const dmin = v0 * 0.1;
		let goal = Math.ceil((this.crank + dmin) / Math.PI - 1e-9) * Math.PI;
		// Leaning into a bend, the inside pedal comes up, if that is no further than the next level position.
		if (Math.abs(lean) > 12 * DEG) {
			const want = lean > 0 ? -Math.PI / 2 : Math.PI / 2;
			const up =
				want + Math.ceil((this.crank + dmin - want) / TAU - 1e-9) * TAU;
			if (up - this.crank <= Math.PI + dmin) goal = up;
		}
		let dd = goal - this.crank;
		if (dd > (v0 * ANIM.settleWithin) / 2) dd = v0 * 0.175;
		this.settle = { a0: this.crank, d: dd, v0, T: (2 * dd) / v0, t: 0 };
		this.mode = 'settle';
	}
}
