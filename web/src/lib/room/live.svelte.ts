import { account } from '$lib/account.svelte';
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
	// Chat is a bounded room log since ADR-0010's amendment (#201): the
	// backlog seeds it on join, live lines ride the tick on top.
	let chatLog = $state<import('$lib/protocol').ChatLine[]>([]);
	// messageId → emoji → count, shared truth from the tick + backlog.
	let chatReactions = $state<Record<string, Record<string, number>>>({});
	// "did I press it" — the client's own knowledge, keyed id:emoji.
	let myReacts = $state<Record<string, boolean>>({});
	let refusal = $state<string | null>(null);
	let refusalAt = 0;
	let socket: WebSocket | null = null;
	let closed = false;
	let attempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
		// Never dial while a socket is already in flight or open — an extra dial
		// is a second presence the server counts and leave() can't reach.
		if (closed || (socket && socket.readyState <= WebSocket.OPEN)) return;
		const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
		socket = new WebSocket(`${scheme}://${location.host}/ws/rooms/${slug}`);
		socket.onopen = () => {
			if (closed) {
				socket?.close();
				return;
			}
			status = 'live';
			attempts = 0;
			const queued = pending;
			pending = [];
			for (const message of queued) send(message);
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
			if (msg.tick) {
				tick = msg.tick;
				if (msg.tick.chat?.length) {
					chatLog = [...chatLog, ...msg.tick.chat].slice(-200);
				}
				if (msg.tick.chatReactions?.length) {
					const next = { ...chatReactions };
					const pressed = { ...myReacts };
					let mineChanged = false;
					for (const change of msg.tick.chatReactions) {
						next[change.messageId] = {
							...next[change.messageId],
							[change.emoji]: change.count,
						};
						// The server echoes the actor: my own tabs reconcile the
						// highlight from truth, not from the click (#219).
						if (change.by && change.by === account.me?.id) {
							pressed[`${change.messageId}:${change.emoji}`] = change.added;
							mineChanged = true;
						}
					}
					chatReactions = next;
					if (mineChanged) myReacts = pressed;
				}
			}
			// A refused command is feedback, not a fault — it stays up long
			// enough to read (ticks arrive every second; clearing on each one
			// made refusals subliminal — audit #219).
			if (msg.error) {
				refusal = msg.error.message;
				refusalAt = Date.now();
			} else if (refusal && Date.now() - refusalAt > 6_000) {
				refusal = null;
			}
		};
		socket.onclose = () => {
			if (closed) return;
			// Remember where the stream broke; the replay starts there.
			if (gapSeq === null) gapSeq = lastSeq;
			// Ride-critical errors are persistent status, never toasts
			// (.claude/rules/errors.md) — and recovery is automatic.
			status = 'reconnecting';
			attempts += 1;
			reconnectTimer = setTimeout(
				connect,
				Math.min(1000 * 2 ** attempts, 10_000),
			);
		};
	}
	connect();

	// Words typed during a reconnect wait here and flush on reopen — a chat
	// line must never silently vanish (audit #219). Metrics are continuous
	// and never queued; stale watts help nobody.
	let pending: ClientMessage[] = [];
	function send(message: ClientMessage) {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		} else if (!message.metrics && pending.length < 16) {
			pending.push(message);
		}
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
		cheer(emoji: string) {
			send({ cheer: { emoji } });
		},
		get chatLog() {
			return chatLog;
		},
		get chatReactions() {
			return chatReactions;
		},
		get myReacts() {
			return myReacts;
		},
		/** The join-time backlog (#201) — replaces the log, seeds reactions. */
		seedChat(
			messages: {
				id: string;
				from: string;
				text: string;
				at: number;
				reactions?: Record<string, number>;
				mine?: string[];
			}[],
		) {
			// Live lines may land before the backlog resolves; the seed merges
			// UNDER them by id — replacing wholesale ate the first seconds of a
			// conversation (audit #219). Live reaction counts stay authoritative.
			const liveIds = new Set(chatLog.map((line) => line.id).filter(Boolean));
			chatLog = [
				...messages
					.filter((m) => !liveIds.has(m.id))
					.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at })),
				...chatLog,
			]
				.sort((a, b) => a.at - b.at)
				.slice(-200);
			const counts: Record<string, Record<string, number>> = {
				...chatReactions,
			};
			const pressed: Record<string, boolean> = { ...myReacts };
			for (const m of messages) {
				if (m.reactions && !counts[m.id]) counts[m.id] = m.reactions;
				for (const emoji of m.mine ?? []) pressed[`${m.id}:${emoji}`] = true;
			}
			chatReactions = counts;
			myReacts = pressed;
		},
		chat(text: string) {
			send({ chat: { from: '', text, at: 0 } });
		},
		/** Toggle my emoji on a message — optimistic; the tick corrects counts. */
		react(messageId: string, emoji: string) {
			myReacts = {
				...myReacts,
				[`${messageId}:${emoji}`]: !myReacts[`${messageId}:${emoji}`],
			};
			send({ chatReact: { messageId, emoji } });
		},
		jukebox(
			action: string,
			videoId?: string,
			title?: string,
			jamUrl?: string,
			positionSec?: number,
			anchorMs?: number,
		) {
			send({
				jukebox: { action, videoId, title, jamUrl, positionSec, anchorMs },
			});
		},
		control(
			action: string,
			workout?: { name: string; json: string; totalSeconds: number },
			gameMode?: string,
		) {
			send({
				control: {
					action,
					workoutName: workout?.name,
					workoutJson: workout?.json,
					totalSeconds: workout?.totalSeconds,
					gameMode,
				},
			});
		},
		close() {
			closed = true;
			if (reconnectTimer !== null) clearTimeout(reconnectTimer);
			socket?.close();
		},
	};
}
