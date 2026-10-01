import { zoneOf } from '$lib/components/zones';
import { toleranceBand } from '$lib/workout/guards';
import { NormPowerMinSeconds } from '$lib/protocol';

/**
 * The ride's numbers while it happens — one module for every riding surface
 * (#3068). A HUD that worked out the tolerance band for itself is how the
 * screen and the saved ride came to disagree (#2159), so nothing that shows a
 * live number computes its own: it reads this.
 *
 * Every formula is stats.ts's, the server's or docs/SPEC.md's, and a second
 * costs the same at minute one and at hour three — nothing here walks the
 * samples. Names follow SPEC's trademark rule: NormPower, Intensity, Load.
 * There is no left/right balance, because FTMS carries none.
 */

/** One second of riding, as the recording admits it. */
export interface LiveSecond {
	watts: number;
	/** The workout block this second is in; a new one starts the block's numbers over. */
	block?: number;
	/**
	 * The rider's own (biased) target, when this second is scored — running,
	 * pedalling, a steady block, no guard up (docs/SPEC.md). Absent is not
	 * scored: the second counts toward the block's average, never its execution.
	 */
	target?: number;
}

export interface LiveStats {
	seconds: number;
	/** Rolling power over the last 3, 10 and 30 s; a shorter ride averages what it has. */
	power3: number;
	power10: number;
	power30: number;
	/** stats.ts's normalizedPower: the plain average under 20 minutes. */
	normPower: number;
	/** NormPower / FTP. */
	intensity: number;
	/** Intensity² × hours × 100, as the server's stats.Load. */
	load: number;
	kj: number;
	/** Seconds per zone, index 1–7 (0 unused), as stats.ts's zoneSeconds. */
	zoneSeconds: number[];
	blockAverage: number;
	/** The block's scored seconds inside the band; null until one is scored. */
	blockExecution: number | null;
}

/** NormPower's rolling window, and the longest rolling power shown. */
const WINDOW = 30;

const EMPTY: LiveStats = {
	seconds: 0,
	power3: 0,
	power10: 0,
	power30: 0,
	normPower: 0,
	intensity: 0,
	load: 0,
	kj: 0,
	zoneSeconds: [0, 0, 0, 0, 0, 0, 0, 0],
	blockAverage: 0,
	blockExecution: null,
};

export function createLiveStats(ftp: () => number) {
	let current = $state.raw<LiveStats>(EMPTY);
	// The last WINDOW seconds, by second modulo WINDOW.
	const ring = new Array<number>(WINDOW).fill(0);
	let seconds = 0;
	let total = 0;
	let sum3 = 0;
	let sum10 = 0;
	let sum30 = 0;
	let fourthSum = 0;
	let fourthCount = 0;
	let zones = [...EMPTY.zoneSeconds];
	let block: number | undefined;
	let blockSum = 0;
	let blockSeconds = 0;
	let blockScored = 0;
	let blockInside = 0;

	/** Slide a k-second sum on by one: the second leaving it is still in the ring. */
	function slide(sum: number, k: number, watts: number): number {
		return seconds >= k
			? sum + watts - ring[(seconds - k) % WINDOW]
			: sum + watts;
	}

	function reset() {
		ring.fill(0);
		seconds = total = sum3 = sum10 = sum30 = fourthSum = fourthCount = 0;
		zones = [...EMPTY.zoneSeconds];
		block = undefined;
		blockSum = blockSeconds = blockScored = blockInside = 0;
		current = EMPTY;
	}

	function push(second: LiveSecond) {
		// The recording's own rounding, so a surface that hands in raw trainer
		// watts still agrees with the summary drawn from the samples.
		const watts = Math.max(0, Math.round(second.watts));
		sum3 = slide(sum3, 3, watts);
		sum10 = slide(sum10, 10, watts);
		sum30 = slide(sum30, WINDOW, watts);
		ring[seconds % WINDOW] = watts;
		seconds++;
		total += watts;
		if (seconds >= WINDOW) {
			fourthSum += Math.pow(sum30 / WINDOW, 4);
			fourthCount++;
		}
		const rider = ftp();
		if (watts > 0) zones[zoneOf(watts, rider)] += 1;

		if (second.block !== block) {
			block = second.block;
			blockSum = blockSeconds = blockScored = blockInside = 0;
		}
		blockSum += watts;
		blockSeconds++;
		if (second.target !== undefined && second.target > 0) {
			blockScored++;
			if (Math.abs(watts - second.target) <= toleranceBand(second.target))
				blockInside++;
		}

		const normPower =
			seconds < NormPowerMinSeconds
				? Math.round(total / seconds)
				: Math.round(Math.pow(fourthSum / fourthCount, 0.25));
		const intensity = rider > 0 ? normPower / rider : 0;
		current = {
			seconds,
			power3: Math.round(sum3 / Math.min(seconds, 3)),
			power10: Math.round(sum10 / Math.min(seconds, 10)),
			power30: Math.round(sum30 / Math.min(seconds, WINDOW)),
			normPower,
			intensity,
			load: intensity * intensity * (seconds / 3600) * 100,
			kj: Math.round(total / 1000),
			zoneSeconds: [...zones],
			blockAverage: Math.round(blockSum / blockSeconds),
			blockExecution: blockScored > 0 ? blockInside / blockScored : null,
		};
	}

	return {
		/** Replaced whole on every second, so a reader re-renders once per push. */
		get current() {
			return current;
		},
		push,
		reset,
	};
}
