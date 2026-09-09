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
import { account } from '$lib/account.svelte';
import { MIN_SAMPLES, openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { createChatLog, type BacklogMessage } from '$lib/room/chat-log.svelte';
import { observeServerTime, resetServerClock } from '$lib/room/server-clock';

/**
 * The live side of one room (#18): a WebSocket to the hub, the latest tick,
 * and reconnect that never needs a button. The server owns shared truth —
 * this store renders it and forwards commands, deciding nothing itself.
 */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Reconnects failed before the banner turns from "reconnecting" to "lost".
 * The backoff spends 1+2+4+8 s before it settles at its 10 s ceiling, the
 * same 15 s the roster waits before announcing the rider gone (docs/SPEC.md):
 * past it the room has said goodbye, and the rider gets the one big button
 * (#1500) while the automatic retry keeps running underneath.
 */
export const SETTLED_ATTEMPTS = 5;

export function createRoomLive(slug: string) {
	let status = $state<LiveStatus>('connecting');
	// The room's chat — the log, its ids, its edits, its reactions — is a
	// module of its own; the socket hands it every tick.
	const chat = createChatLog();
	let tick = $state<ServerTick | null>(null);
	// Finished sessions (ADR-0034). Unlike everything else here these are
	// durable: the backlog seeds them and the tick adds the one written while
	// this rider was standing in the room.
	let recaps = $state<import('$lib/protocol').SessionRecap[]>([]);
	// What the room did (#321), interleaved with the talking by the chat pane.
	// Ephemeral by design (ADR-0019): nothing seeds these on join, and a
	// reload forgets them — "now playing" is worthless tomorrow.
	let roomEvents = $state<RoomEvent[]>([]);
	function mergeEvents(incoming: RoomEvent[]) {
		const next = [...roomEvents];
		for (const event of incoming) {
			// A growing burst re-sends its own id ("queued 3 tracks"):
			// replace the line in place, never stack a second one.
			const at = next.findIndex((have) => have.id === event.id);
			if (at >= 0) next[at] = event;
			else next.push(event);
		}
		roomEvents = next.slice(-100);
	}
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
	let socket: WebSocket | null = null;
	let closed = false;
	let attempts = $state(0);
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
	// The last seq the hub said it received from this rider — every tick
	// carries the latest metrics per rider, seq included. The replay starts
	// there, not at the last one this tab stamped: on a silent drop the socket
	// reports success for tens of seconds of samples it never delivered, and
	// starting past them lost them for good (#1467). The overlap dedupes by
	// seq on the server, so over-replaying costs nothing.
	let acked = 0;
	let gapSeq: number | null = null;
	// One row a second (#791, audit 2026-09-09): the buffer is what a replay
	// sends and what a recovered .fit reads as one row per second, and a
	// trainer notifying at 2 Hz used to double both.
	let bufferedSecond = -1;
	// One buffer per SESSION, not per join (#1541): opened when the timeline
	// starts and ended when it closes, so the tab closed after a ride the
	// hub saved does not come back as "an unfinished ride" on /ride. Stamped
	// with server truth — the workout's name and the start the tick implies
	// — because that is what a recovered .fit is named and dated by.
	let riding = false;
	let openedFor = 0;
	function followSession(t: ServerTick) {
		const phase = t.state?.phase;
		const now =
			phase === 'countdown' || phase === 'running' || phase === 'paused';
		if (now === riding) return;
		riding = now;
		if (!now) {
			settle(buffer);
			buffer = null;
			return;
		}
		const startedAt = t.at - (t.state.elapsed ?? 0) * 1000;
		openedFor = startedAt;
		bufferedSecond = -1;
		void openRideBuffer({
			rideId: `room-${slug}-${startedAt}`,
			startedAt,
			workoutName: t.state.workoutName || 'Room ride',
		}).then((opened) => {
			if (riding && openedFor === startedAt) buffer = opened;
		});
	}

	// The close is the hub saying it saved what it heard — not that it heard
	// everything (#1536). A socket down when the timeline ran out replays its
	// tail into a room that has already saved, and nothing reads it again.
	// So a tail the hub never acknowledged, a minute or more of it, keeps the
	// buffer unfinished: /ride offers the .fit back. Export only — a room
	// buffer carries no workoutJson, so the card shows no Save that would
	// mint a second ride beside the hub's.
	function settle(opened: RideBuffer | null) {
		if (!opened) return;
		void opened.since(acked).then((tail) => {
			if (tail.length < MIN_SAMPLES) opened.end();
		});
	}

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
				// The ack before the session follows it: the closing tick's
				// own seq is what says whether the tail was heard (#1536).
				const me = account.me?.id;
				const mine = me ? msg.tick.riders?.[me] : undefined;
				if (mine) acked = mine.seq;
				followSession(msg.tick);
				if (msg.tick.recap) {
					// The session that just ended left a card (ADR-0034), on
					// the tick after its row landed. Riders who were not here
					// read the same row from the backlog when they arrive.
					const written = msg.tick.recap;
					if (!recaps.some((r) => r.id === written.id))
						recaps = [...recaps, written];
				}
				chat.onTick(msg.tick);
				if (msg.tick.events?.length) mergeEvents(msg.tick.events);
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
			if (gapSeq === null) gapSeq = acked;
			// Ride-critical errors are persistent status, never toasts
			// (.claude/rules/errors.md) — and recovery is automatic.
			status = 'reconnecting';
			reconnectTimer = setTimeout(
				connect,
				Math.min(1000 * 2 ** attempts, 10_000),
			);
			attempts += 1;
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
		/** Reconnecting past the backoff's settling point: time for the button. */
		get lost() {
			return status === 'reconnecting' && attempts >= SETTLED_ATTEMPTS;
		},
		/** The one big button: dial now instead of waiting out the backoff. */
		retry() {
			if (reconnectTimer !== null) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			connect();
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
			const at = Date.now();
			const second = Math.floor(at / 1000);
			if (second > bufferedSecond) {
				bufferedSecond = second;
				buffer?.append({
					seq: metrics.seq,
					watts: metrics.watts,
					cadence: metrics.cadence ?? 0,
					heartRate: metrics.hr ?? 0,
					at,
				});
			}
			send({ metrics });
		},
		/** The room ride ended on this screen: the buffer is not a crash to
		 * recover, unless the hub never heard its tail (#1536). */
		finish() {
			settle(buffer);
			buffer = null;
		},
		/** Fire a soundboard pad (#877): only the clip id crosses the wire —
		 * the hub fills in who fired it, and every listener fetches the audio. */
		fireClip(clipId: string) {
			send({ board: { clipId } });
		},
		/** Stop your own clip (#1321): a fire with no clip, so every listener
		 * ends your voice. */
		stopClip() {
			send({ board: { clipId: '' } });
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
		get recaps() {
			return recaps;
		},
		/** The room's stored session cards, read with the chat backlog. */
		seedRecaps(rows: import('$lib/protocol').SessionRecap[]) {
			// Merged rather than replaced, and by id: a recap can arrive on
			// the tick before this resolves, and a reconnect re-reads the
			// same backlog (the same rule seedChat follows).
			const have = new Set(recaps.map((r) => r.id));
			recaps = [...recaps, ...rows.filter((r) => !have.has(r.id))].sort(
				(a, b) => a.endedAt - b.endedAt,
			);
		},
		get chatLog() {
			return chat.log;
		},
		get roomEvents() {
			return roomEvents;
		},
		/**
		 * A line this client made itself (#664: a screen share only LiveKit
		 * saw). Same list, same cap, never sent — the hub knows nothing of it.
		 */
		pushEvent(event: RoomEvent) {
			mergeEvents([event]);
		},
		get chatReactions() {
			return chat.reactions;
		},
		get myReacts() {
			return chat.myReacts;
		},
		/** The join-time backlog (#201) — replaces the log, seeds reactions. */
		seedChat(messages: BacklogMessage[]) {
			chat.seed(messages);
		},
		/** False when a reconnect queue too full to take the line refused it —
		 * the caller still holds the words and must say so. */
		chat(text: string, imageId?: string): boolean {
			return send({ chat: { from: '', text, imageId, at: 0 } });
		},
		/** Toggle my emoji on a message — optimistic; the tick corrects counts. */
		react(messageId: string, emoji: string) {
			chat.toggleMine(messageId, emoji);
			send({ chatReact: { messageId, emoji } });
		},
		/** One jukebox command. The wire shape IS the argument (#286) — six
		 * positional optionals were a bug waiting to be passed in the wrong
		 * order, and two of them already had been. */
		jukebox(command: import('$lib/protocol').JukeboxCommand) {
			// The dock's own end-of-track report is not the rider acting: it
			// must not wipe a refusal they are still reading (#824).
			if (command.action !== 'ended') jukeboxRefusal = null;
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
