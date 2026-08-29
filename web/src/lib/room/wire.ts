import type { Metrics } from '$lib/ble/arbitrate';
import type { RiderMetrics } from '$lib/protocol';

/**
 * Build the sample that leaves this browser for the room.
 *
 * The one privacy-bearing line lives here so it is provable in a test rather
 * than buried in a component: heart rate crosses the wire only while shared
 * (#62, ADR-0008). Zero is the wire's "absent" — the Go side omits hr=0 —
 * so a stopped share reads as "no strap", not as a lie.
 */
export function wireMetrics(
	metrics: Metrics,
	shareHr: boolean,
	seq: number,
): RiderMetrics {
	return {
		watts: Math.max(0, Math.round(metrics.watts)),
		cadence: Math.max(0, Math.round(metrics.cadence)),
		hr: shareHr ? Math.max(0, Math.round(metrics.heartRate ?? 0)) : 0,
		seq,
	};
}
