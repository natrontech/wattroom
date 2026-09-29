import {
	CPEstimateLongSeconds,
	CPEstimateShortSeconds,
	CPLongSeconds,
	CPShortSeconds,
} from '$lib/protocol';

/**
 * A rider's critical power and W′ (#3262): the one model the matches gauge,
 * the devil (#3170) and a pacer read. Its twin is server/internal/road's
 * cpw.go; the golden vectors in server/internal/protocol/testdata hold the
 * two to 0.1 %.
 */
export interface CPW {
	/** The power a rider holds without drawing on W′, watts. */
	cp: number;
	/** The work above CP a rider has to spend, joules. */
	wPrime: number;
	/** Fitted from the 5- and 20-minute bests: the curve lacks a 3- or 12-minute one. */
	estimate: boolean;
}

/**
 * Puts both bests on the hyperbola P = CP + W′/t:
 * W′ = (P1 − P2)·t1·t2 / (t2 − t1), CP = P1 − W′/t1 (RESEARCH §13.1).
 */
function twoPoint(
	p1: number,
	t1: number,
	p2: number,
	t2: number,
	estimate: boolean,
): CPW | null {
	if (p1 <= 0 || p2 <= 0 || p1 <= p2) return null;
	const wPrime = ((p1 - p2) * t1 * t2) / (t2 - t1);
	return { cp: p1 - wPrime / t1, wPrime, estimate };
}

/**
 * The two-point model fitted to a rider's 90-day bests, in watts (0 is none):
 * from 3 and 12 minutes, else from 5 and 20 flagged an estimate. Null when
 * neither pair holds a W′ to fit.
 */
export function fitCPW(bests: {
	best3m: number;
	best12m: number;
	best5m: number;
	best20m: number;
}): CPW | null {
	return (
		twoPoint(
			bests.best3m,
			CPShortSeconds,
			bests.best12m,
			CPLongSeconds,
			false,
		) ??
		twoPoint(
			bests.best5m,
			CPEstimateShortSeconds,
			bests.best20m,
			CPEstimateLongSeconds,
			true,
		)
	);
}

/**
 * A rider's W′ balance through a ride, a second at a time: Skiba's
 * differential model (Skiba et al. 2015). Above CP the balance spends exactly
 * what the rider rides over it; below, it recovers towards W′ with the time
 * constant W′ / (CP − P). Nothing clamps it at zero — a rider can ride
 * through empty, and the gauge is the one to say so.
 */
export function createWBal(model: CPW) {
	let balance = model.wPrime;
	return {
		/** Joules of W′ left. */
		get balance() {
			return balance;
		},
		/** One second at these watts. */
		step(watts: number): void {
			if (watts >= model.cp) {
				balance -= watts - model.cp;
				return;
			}
			const spent = model.wPrime - balance;
			balance =
				model.wPrime - spent * Math.exp(-(model.cp - watts) / model.wPrime);
		},
	};
}
