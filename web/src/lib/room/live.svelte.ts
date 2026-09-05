import { account } from '$lib/account.svelte';
import type {
	ClientMessage,
	Poke,
	RiderMetrics,
	RoomEvent,
	SensorClaim,
	SensorPairing,
	ServerMessage,
	ServerTick,
} from '$lib/protocol';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { observeServerTime, resetServerClock } from '$lib/room/server-clock';

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
	// What the room did (#321), interleaved with the talking by the chat pane.
	// Ephemeral by design (ADR-0019): nothing seeds these on join, and a
	// reload forgets them — "now playing" is worthless tomorrow.
	let roomEvents = $state<RoomEvent[]>([]);
	// messageId → emoji → count, shared truth from the tick + backlog.
	let chatReactions = $state<Record<string, Record<string, number>>>({});
	// "did I press it" — the client's own knowledge, keyed id:emoji.
	let myReacts = $state<Record<string, boolean>>({});
	let refusal = $state<string | null>(null);
	let refusalAt = 0;
	let jukeboxRefusal = $state<string | null>(null);
	let jukeboxRefusalAt = 0;
	// What the hub says this tab holds, and where the rider's other screens
	// hold the rest (#610). Server truth: a tab learns here that its claim
	// was refused, so nothing renders "paired" off its own click alone.
	let pairing = $state<SensorPairing>({});
	// Addressed off the tick like pairing: every update is one new request for
	// this rider's attention, carrying the authenticated sender and server time.
	let lastPoke = $state<Poke | null>(null);
	// The last claim sent, replayed on every reconnect — a fresh socket is a
	// fresh claim as far as the hub is concerned, and a trainer that stays
	// connected through a drop must not come back as somebody else's.
	let claim: SensorClaim | null = null;
	// Ids the async save assigned (#219), keyed fromId:at, waiting for their
	// line — usually applied the moment they arrive, kept only when a flood
	// carries the line to a later tick than its id.
	let pendingIds: Record<string, string> = {};
	let socket: WebSocket | null = null;
	let closed = false;
	let attempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	// Crash safety (#19): metrics buffer locally as well as streaming. When the
	// socket comes back, everything since the drop replays as a backfill — the
	// server dedupes by seq, so the overlap costs nothing.
	let buffer: RideBuffer | null = null;
	// The seq stream belongs HERE, beside the buffer that replays it and the
	// gap marker the replay starts from (#522) — not to whoever happens to
	// hold the trainer. One socket session, one stream: that is the unit the
	// server's ride record dedupes against, and the client's counter must not
	// be able to restart inside it.
	let seq = 0;
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
			// A fresh socket may have reached a restarted server; the old
			// clock window would hold a stale offset for eight seconds.
			resetServerClock();
			status = 'live';
			attempts = 0;
			const queued = pending;
			pending = [];
			for (const message of queued) send(message);
			// Before the backfill: the replay below is metrics, and the hub
			// only takes metrics from the screen holding the trainer.
			if (claim) send({ sensors: claim });
			// The hub drops away with the rider's last socket (#706), and a
			// reconnect is a new socket. Re-declare it, or a rider who stepped
			// out quietly comes back on everyone else's screen but their own.
			if (away) send({ away: { away } });
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
			if (msg.poke) lastPoke = msg.poke;
			if (msg.pairing) {
				// Off the tick by design (#610) — it is addressed to this
				// rider's sockets, not to the room.
				pairing = msg.pairing;
			}
			if (msg.tick) {
				// Before anything reads it: the tick's own timestamp is what
				// keeps the jukebox playhead on server time (#286).
				observeServerTime(msg.tick.at);
				tick = msg.tick;
				if (msg.tick.chatIds?.length) {
					// The save happens off the server's read loop (#219): lines
					// arrive id-less, their persisted id follows here and turns
					// reactions on for them.
					for (const assigned of msg.tick.chatIds) {
						pendingIds[`${assigned.fromId}:${assigned.at}`] = assigned.id;
					}
				}
				if (msg.tick.events?.length) {
					const next = [...roomEvents];
					for (const event of msg.tick.events) {
						// A growing burst re-sends its own id ("queued 3 tracks"):
						// replace the line in place, never stack a second one.
						const at = next.findIndex((have) => have.id === event.id);
						if (at >= 0) next[at] = event;
						else next.push(event);
					}
					roomEvents = next.slice(-100);
				}
				if (msg.tick.chat?.length) {
					// A line posted from outside the room (#468) arrives with its
					// id already on it — and may already be here from a backlog
					// fetch that raced the tick. One line, once.
					const have = new Set(chatLog.map((line) => line.id).filter(Boolean));
					const fresh = msg.tick.chat.filter(
						(line) => !line.id || !have.has(line.id),
					);
					if (fresh.length > 0) chatLog = [...chatLog, ...fresh].slice(-200);
				}
				if (Object.keys(pendingIds).length > 0) {
					chatLog = chatLog.map((line) => {
						const id = line.id
							? undefined
							: pendingIds[`${line.fromId}:${line.at}`];
						if (!id) return line;
						delete pendingIds[`${line.fromId}:${line.at}`];
						return { ...line, id };
					});
					// An id whose line never surfaced (pruned by the 200-line cap)
					// would pool forever — reset the stragglers.
					if (Object.keys(pendingIds).length > 64) pendingIds = {};
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
				if (msg.error.code.startsWith('jukebox_')) {
					jukeboxRefusal = msg.error.message;
					jukeboxRefusalAt = Date.now();
				} else {
					refusal = msg.error.message;
					refusalAt = Date.now();
				}
			} else {
				const now = Date.now();
				if (refusal && now - refusalAt > 6_000) refusal = null;
				if (jukeboxRefusal && now - jukeboxRefusalAt > 6_000)
					jukeboxRefusal = null;
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
	// A long reconnect under a talkative rider fills this; past it, send()
	// refuses rather than drops, so the caller can hand the words back (#650).
	const PENDING_LIMIT = 16;
	// This socket's view of its rider being away (#706), kept so a reconnect
	// can re-declare it. Not $state: nothing renders from here — the roster
	// on the tick is what every screen draws, this rider's tile included.
	let away = false;
	/** True once the message is on the wire or waiting for it; false when the
	 * queue is full and the words are still the caller's to keep. Metrics are
	 * never queued and never refused: the next sample supersedes a lost one. */
	function send(message: ClientMessage): boolean {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
			return true;
		}
		if (message.metrics) return true;
		if (pending.length >= PENDING_LIMIT) return false;
		pending.push(message);
		return true;
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
		get jukeboxRefusal() {
			return jukeboxRefusal;
		},
		/** What this tab holds and what its rider's other screens hold (#610). */
		get pairing() {
			return pairing;
		},
		get lastPoke() {
			return lastPoke;
		},
		/**
		 * Tell the hub which sensors this tab has connected. Idempotent: the
		 * whole set every time, so a release is just a shorter list, and the
		 * same set twice sends nothing.
		 */
		claimSensors(next: SensorClaim) {
			const same =
				claim !== null &&
				claim.tab === next.tab &&
				claim.device === next.device &&
				claim.held.length === next.held.length &&
				claim.held.every((kind, i) => kind === next.held[i]);
			claim = next;
			if (!same) send({ sensors: next });
		},
		/** Stamps the sample with this session's next seq, then sends it. */
		sendMetrics(sample: Omit<RiderMetrics, 'seq'>) {
			const metrics: RiderMetrics = { ...sample, seq: ++seq };
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
		poke(to: string) {
			send({ poke: { to } });
		},
		/**
		 * Step out, or come back (#706). The whole state, never a toggle: the
		 * hub cannot then be left holding the opposite of what the rider sees
		 * because one message went missing.
		 */
		setAway(next: boolean) {
			away = next;
			send({ away: { away: next } });
		},
		get chatLog() {
			return chatLog;
		},
		get roomEvents() {
			return roomEvents;
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
				fromId?: string;
				text: string;
				imageId?: string;
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
					.map((m) => ({
						id: m.id,
						from: m.from,
						fromId: m.fromId,
						text: m.text,
						imageId: m.imageId,
						at: m.at,
					})),
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
		/** False when a reconnect queue too full to take the line refused it —
		 * the caller still holds the words and must say so. */
		chat(text: string, imageId?: string): boolean {
			return send({ chat: { from: '', text, imageId, at: 0 } });
		},
		/** Toggle my emoji on a message — optimistic; the tick corrects counts. */
		react(messageId: string, emoji: string) {
			myReacts = {
				...myReacts,
				[`${messageId}:${emoji}`]: !myReacts[`${messageId}:${emoji}`],
			};
			send({ chatReact: { messageId, emoji } });
		},
		/** One jukebox command. The wire shape IS the argument (#286) — six
		 * positional optionals were a bug waiting to be passed in the wrong
		 * order, and two of them already had been. */
		jukebox(command: import('$lib/protocol').JukeboxCommand) {
			jukeboxRefusal = null;
			send({ jukebox: command });
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
