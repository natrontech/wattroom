import type {
	ClientMessage,
	RiderMetrics,
	ServerMessage,
	ServerTick,
} from '$lib/protocol';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';

/**
 * The live side of one room (#18): a WebSocket to the hub, the latest tick,
 * and reconnect that never needs a button. The server owns shared truth —
 * this store renders it and forwards commands, deciding nothing itself.
 */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export function createRoomLive(slug: string) {
	let status = $state<LiveStatus>('connecting');
	let tick = $state<ServerTick | null>(null);
	let refusal = $state<string | null>(null);
	let socket: WebSocket | null = null;
	let closed = false;
	let attempts = 0;

	// Crash safety (#19): metrics buffer locally as well as streaming. When the
	// socket comes back, everything since the drop replays as a backfill — the
	// server dedupes by seq, so the overlap costs nothing.
	let buffer: RideBuffer | null = null;
	let lastSeq = 0;
	let gapSeq: number | null = null;
	void openRideBuffer({
		rideId: `room-${slug}-${Date.now()}`,
		startedAt: Date.now(),
		workoutName: `room ${slug}`,
	}).then((opened) => (buffer = opened));

	function connect() {
		const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
		socket = new WebSocket(`${scheme}://${location.host}/ws/rooms/${slug}`);
		socket.onopen = () => {
			status = 'live';
			attempts = 0;
			if (gapSeq !== null) {
				const since = gapSeq;
				gapSeq = null;
				void buffer?.since(since).then((samples) => {
					if (samples.length > 0)
						send({
							backfill: {
								samples: samples.map((sample) => ({
									watts: sample.watts,
									cadence: sample.cadence,
									hr: sample.heartRate,
									seq: sample.seq,
								})),
							},
						});
				});
			}
		};
		socket.onmessage = (event) => {
			const msg = JSON.parse(event.data) as ServerMessage;
			if (msg.tick) tick = msg.tick;
			// A refused command is feedback, not a fault — shown, then cleared on
			// the next successful tick.
			if (msg.error) refusal = msg.error.message;
			else refusal = null;
		};
		socket.onclose = () => {
			if (closed) return;
			// Remember where the stream broke; the replay starts there.
			if (gapSeq === null) gapSeq = lastSeq;
			// Ride-critical errors are persistent status, never toasts
			// (.claude/rules/errors.md) — and recovery is automatic.
			status = 'reconnecting';
			attempts += 1;
			setTimeout(connect, Math.min(1000 * 2 ** attempts, 10_000));
		};
	}
	connect();

	function send(message: ClientMessage) {
		if (socket?.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify(message));
	}

	return {
		get status() {
			return status;
		},
		get tick() {
			return tick;
		},
		get refusal() {
			return refusal;
		},
		sendMetrics(metrics: RiderMetrics) {
			lastSeq = metrics.seq;
			buffer?.append({
				seq: metrics.seq,
				watts: metrics.watts,
				cadence: metrics.cadence ?? 0,
				heartRate: metrics.hr ?? 0,
				at: Date.now(),
			});
			send({ metrics });
		},
		/** The room ride ended cleanly; its buffer is not a crash to recover. */
		finish() {
			buffer?.end();
		},
		jukebox(action: string, videoId?: string, title?: string) {
			send({ jukebox: { action, videoId, title } });
		},
		control(
			action: string,
			workout?: { name: string; json: string; totalSeconds: number },
		) {
			send({
				control: {
					action,
					workoutName: workout?.name,
					workoutJson: workout?.json,
					totalSeconds: workout?.totalSeconds,
				},
			});
		},
		close() {
			closed = true;
			socket?.close();
		},
	};
}
