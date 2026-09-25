import type { BufferedSample } from '$lib/ride/buffer';
import {
	MaxBackfillBatch,
	type RiderMetrics,
	type ServerTick,
} from '$lib/protocol';

/**
 * A reconnect's replay, as the hub takes it (#2814, #2839).
 *
 * The hub keeps a session ride by the timeline second, and it knows that
 * second only for a live sample. A row that reaches it late, from the
 * buffer, has to say when it was ridden, and with what trim and guard:
 * without them a replayed second landed at the end of the record and was
 * scored as if the rider had no trim and no guard.
 */

/** A frame inside the same second as the last is dropped whole by the hub. */
export const REPLAY_SPACING_MS = 1_500;

/** Where the timeline's second 0 sits on the server's clock; null while it is not running. */
export function timelineOrigin(
	tick: Pick<ServerTick, 'at' | 'state'>,
): number | null {
	return tick.state?.phase === 'running'
		? tick.at - (tick.state.elapsed ?? 0) * 1000
		: null;
}

/**
 * The timeline second at a server time. Undefined while no timeline runs —
 * a paused session, or none — which the hub leaves out of the session's
 * ride, as it leaves out a live second outside the running timeline. Through
 * a drop no tick arrives, so the last origin heard carries the count on.
 */
export function timelineSecond(
	origin: number | null,
	serverAt: number,
): number | undefined {
	return origin === null
		? undefined
		: Math.max(0, Math.floor((serverAt - origin) / 1000));
}

/** Buffered rows as backfill frames the hub takes whole. */
export function replayFrames(rows: BufferedSample[]): RiderMetrics[][] {
	const frames: RiderMetrics[][] = [];
	for (let i = 0; i < rows.length; i += MaxBackfillBatch)
		frames.push(
			rows.slice(i, i + MaxBackfillBatch).map((row) => ({
				watts: row.watts,
				cadence: row.cadence,
				hr: row.heartRate,
				seq: row.seq,
				bias: row.bias,
				clock: row.clock,
				released: row.released || undefined,
			})),
		);
	return frames;
}
