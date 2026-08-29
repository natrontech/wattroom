import type {
	ClientMessage,
	RiderMetrics,
	ServerMessage,
	ServerTick,
} from '$lib/protocol';

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

	function connect() {
		const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
		socket = new WebSocket(`${scheme}://${location.host}/ws/rooms/${slug}`);
		socket.onopen = () => {
			status = 'live';
			attempts = 0;
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
			send({ metrics });
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
