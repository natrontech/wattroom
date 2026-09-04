import { account } from '$lib/account.svelte';
import { api } from '$lib/api';
import { announce } from '$lib/messages/announce';
import { notify } from '$lib/notify.svelte';
import { presence } from '$lib/presence.svelte';
import { createProfileStore } from '$lib/profile.svelte';
import { pullProfile } from '$lib/profile-sync.svelte';
import { createRoomAv } from '$lib/room/av.svelte';
import { createRoomLive } from '$lib/room/live.svelte';
import { createRecording } from '$lib/room/recording.svelte';
import { createRide } from '$lib/room/ride.svelte';
import { sensorClaim } from '$lib/room/sensor-claim';
import { missedSince, type Missed } from '$lib/room/unread';
import { announcePoke } from '$lib/room/poke';
import { parseSharedWorkout } from '$lib/room/workout';
import { play, setDucked } from '$lib/sound/cues';
import type { SessionState } from '$lib/protocol';
import type { Segment, Workout } from '$lib/workout/types';

/**
 * The room you are IN (#173, ADR-0010's logical end): joining is a STATE,
 * not a page. The WS presence and the voice connection live here, above the
 * router — open /workouts, run a ramp test, ride solo, and you are still in
 * your room, exactly like idling in a Discord server. Leaving is an
 * explicit act, never a navigation side-effect.
 *
 * One room at a time: joining another leaves the first — you cannot stand
 * in two lounges.
 */
type Connection = {
	slug: string;
	live: ReturnType<typeof createRoomLive>;
	av: ReturnType<typeof createRoomAv>;
	/** The rider's FTP/weight cache, pulled from the account (ADR-0009). */
	profile: ReturnType<typeof createProfileStore>;
	/** What you rode this session — the ride writes it, the summary reads it. */
	recording: ReturnType<typeof createRecording>;
	/** The trainer, and the targets it holds. Lives here, not on a page (#521). */
	ride: ReturnType<typeof createRide>;
	/**
	 * What was said while you were somewhere else (#504) — null while the
	 * Chat place is open. It lives here, not on the room's shell: the log
	 * does, and the sidebar marks the Chat place off the same answer (#568).
	 */
	missed: () => Missed | null;
	/** The room's shell reports the Chat place; the router lives above this. */
	readingChat: (open: boolean) => void;
	/** The shared session and its workout, parsed once per connection. */
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	workout: () => Workout | null;
	dispose: () => void;
};

let current = $state<Connection | null>(null);

/** The chat backlog (#201) — a nicety; live chat still works without it. */
function loadBacklog(slug: string, live: ReturnType<typeof createRoomLive>) {
	void api<{ messages?: Parameters<typeof live.seedChat>[0] }>(
		`/api/rooms/${slug}/chat`,
	).then((res) => {
		if (res.ok && res.data?.messages) live.seedChat(res.data.messages);
	});
}

function connect(slug: string): Connection {
	const live = createRoomLive(slug);
	const av = createRoomAv(slug);
	// The chat backlog (#201): loaded once per join — the log follows the
	// connection, not the page, like everything else here.
	loadBacklog(slug, live);
	// Presence announces itself (#148) from HERE, not the page — someone
	// arriving is audible even while you are off browsing workouts; hidden
	// tabs get the browser notification instead (#202).
	let known: Set<string> | null = null;
	// Blip only for lines newer than the connection itself — the backlog can
	// never replay, and the log's length cap can never freeze the notifier
	// the way index-tracking did (audit #219).
	let lastChatAt = Date.now();
	let lastPhase: string | null = null;
	// Assigned in the root below: the Chat place being open is the one fact
	// behind three answers — what you missed, whether the sidebar marks Chat,
	// and whether an arriving line is worth announcing.
	let missedOf!: () => Missed | null;
	let readingChat!: (open: boolean) => void;
	// Assigned inside the root below, which runs synchronously.
	let profile!: ReturnType<typeof createProfileStore>;
	let recording!: ReturnType<typeof createRecording>;
	let ride!: ReturnType<typeof createRide>;
	let sharedOf!: () => SessionState | undefined;
	let segmentsOf!: () => Segment[];
	let workoutOf!: () => Workout | null;
	const dispose = $effect.root(() => {
		// The trainer belongs to the connection, not to a page (#521). It is a
		// property of standing in the room, exactly like the socket and the
		// voice channel — and the room's shell unmounting on the way to
		// /workouts used to disconnect it while you were still in the room.
		//
		// It also gives the metrics stream one `seq` per session (#522): a
		// per-mount counter restarted at 1, and the server's ride record
		// dedupes by seq, so every sample after a return to the room was
		// dropped as a duplicate. The tiles kept moving, which is why it read
		// as half-working; the execution meter and the saved ride did not.
		profile = createProfileStore();
		recording = createRecording();
		// The account is the truth for FTP and weight (ADR-0009). The root
		// layout pulls on boot; a connection that outlives many pages has to
		// pull too, or a ramp-measured FTP never reaches the room's targets.
		$effect(() => {
			if (account.me) pullProfile(profile);
		});

		// "Seen" is the Chat place having been open — standing in the room
		// counts as reading it (#468), so the room's own unread cannot say it.
		let chatOpen = $state(false);
		let chatSeenAt = $state(Date.now());
		$effect(() => {
			if (chatOpen) chatSeenAt = live.chatLog.at(-1)?.at ?? Date.now();
		});
		const missed = $derived(
			chatOpen ? null : missedSince(live.chatLog, chatSeenAt, account.me?.id),
		);
		missedOf = () => missed;
		readingChat = (open: boolean) => (chatOpen = open);

		const shared = $derived(live.tick?.state);
		const parsed = $derived(parseSharedWorkout(shared?.workoutJson));
		sharedOf = () => shared;
		segmentsOf = () => parsed.segments;
		workoutOf = () => parsed.workout;

		ride = createRide({
			live,
			profile,
			recording,
			myId: () => account.me?.id,
			shared: () => shared,
			segments: () => parsed.segments,
		});

		// One sensor, one screen (#610). The claim belongs to the CONNECTION
		// for the same reason the trainer does: it has to survive the room's
		// shell unmounting on the way to another page, or a walk to /workouts
		// would hand the rider's own trainer back to their phone.
		$effect(() => {
			live.claimSensors(sensorClaim(ride.trainer !== null));
		});

		// Away is per rider in the hub (#706), so every one of that rider's
		// screens follows the roster truth. The tab that pressed the button
		// updates itself immediately in RoomShell; this is what also mutes the
		// desktop when the phone pressed it, and restores each tab to what that
		// tab had live before.
		$effect(() => {
			const mine = live.tick?.roster.find(
				(rider) => rider.id === account.me?.id,
			);
			if (mine) void av.setAway(!!mine.away);
		});

		$effect(() => {
			const roster = live.tick?.roster ?? [];
			const ids = new Set(roster.map((rider) => rider.id));
			if (live.status !== 'live') return;
			if (known === null) {
				known = ids;
				return;
			}
			const before = known;
			known = ids;
			const arrived = roster.filter((rider) => !before.has(rider.id));
			if (arrived.length > 0) {
				play('join');
				notify.push(
					slug,
					`${arrived.map((rider) => rider.name).join(', ')} joined the room`,
					`join-${slug}`,
				);
			} else if ([...before].some((id) => !ids.has(id))) {
				play('leave');
			}
		});

		// Chat lands audibly (#202), and visibly off the Chat place (#568) —
		// never for your own lines.
		$effect(() => {
			const fresh = live.chatLog.filter((line) => line.at > lastChatAt);
			if (fresh.length === 0) return;
			lastChatAt = fresh[fresh.length - 1].at;
			const where =
				presence.rooms.find((room) => room.slug === slug)?.name ?? slug;
			for (const line of fresh) {
				// Ids beat display names — a namesake must not be muted (#219).
				const mine = line.fromId
					? line.fromId === account.me?.id
					: line.from === account.me?.displayName;
				if (mine) continue;
				// The same tag the presence feed uses for this room: whichever
				// sees the line first announces it, and never both (#568).
				announce({
					tag: `chat-${slug}`,
					at: line.at,
					title: `${line.from} · ${where}`,
					body: line.text || (line.imageId ? 'sent an image' : ''),
					href: `/r/${slug}/chat`,
					reading: chatOpen && !document.hidden,
				});
			}
		});

		// A poke is delivered to every socket of this rider. localStorage picks
		// one tab on each device to make the sound/notification, while each
		// device still receives it independently. play() keeps the receiver's
		// cue fader authoritative; notify.push() keeps their permission and the
		// hidden-tab gate authoritative.
		$effect(() => {
			const poke = live.lastPoke;
			const where =
				presence.rooms.find((room) => room.slug === slug)?.name ?? slug;
			announcePoke(poke, slug, where);
		});

		// Room audio follows the connection, not the page (#216): the gate
		// threshold doubles while the jukebox plays, and cues duck under a
		// voice — wherever in the app you are standing.
		$effect(() => {
			av.setDeckPlaying(!!live.tick?.jukebox?.playing);
		});
		$effect(() => {
			setDucked(
				Object.entries(av.speaking).some(
					([id, active]) => active && id !== account.me?.id,
				),
			);
			// Leaving mid-sentence must not park every cue at 35% forever.
			return () => setDucked(false);
		});

		// A reconnect leaves a chat gap the tick stream never backfills —
		// re-fetch the log when the socket comes back; the id-merge in
		// seedChat makes this idempotent (audit #219).
		let wasReconnecting = false;
		$effect(() => {
			const status = live.status;
			if (status === 'reconnecting') wasReconnecting = true;
			else if (status === 'live' && wasReconnecting) {
				wasReconnecting = false;
				loadBacklog(slug, live);
			}
		});

		// PTT keys work on EVERY page while in voice — and a keyup lost to
		// navigation or focus loss must never leave the mic hot (audit #219).
		$effect(() => {
			if (typeof window === 'undefined') return;
			const key = (event: KeyboardEvent, held: boolean) => {
				if (av.mode !== 'ptt' || event.code !== 'Space') return;
				const target = event.target as HTMLElement;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target.isContentEditable
				)
					return;
				event.preventDefault();
				if (!held || !event.repeat) av.setPtt(held);
			};
			const down = (e: KeyboardEvent) => key(e, true);
			const up = (e: KeyboardEvent) => key(e, false);
			const release = () => av.pttHeld && av.setPtt(false);
			window.addEventListener('keydown', down);
			window.addEventListener('keyup', up);
			window.addEventListener('blur', release);
			document.addEventListener('visibilitychange', release);
			return () => {
				release();
				window.removeEventListener('keydown', down);
				window.removeEventListener('keyup', up);
				window.removeEventListener('blur', release);
				document.removeEventListener('visibilitychange', release);
			};
		});

		// LiveKit dropping us while live gets ONE automatic rejoin with a
		// fresh token — covers the 6h expiry and transient drops (#219).
		let seenDrops = 0;
		$effect(() => {
			const drops = av.dropped;
			if (drops > seenDrops) {
				seenDrops = drops;
				setTimeout(() => {
					if (roomConnection.current?.slug === slug) void av.join();
				}, 2_000);
			}
		});

		// A session starting is the one event nobody wants to miss (#202).
		$effect(() => {
			const phase = live.tick?.state.phase ?? null;
			const before = lastPhase;
			lastPhase = phase;
			if (
				before !== null &&
				before !== phase &&
				(phase === 'countdown' || phase === 'running') &&
				before !== 'countdown' &&
				before !== 'paused'
			) {
				notify.push(
					slug,
					'The session is starting — saddle up',
					`session-${slug}`,
				);
			}
		});
	});
	return {
		slug,
		live,
		av,
		profile,
		recording,
		ride,
		missed: missedOf,
		readingChat,
		shared: sharedOf,
		segments: segmentsOf,
		workout: workoutOf,
		dispose,
	};
}

export const roomConnection = {
	get current() {
		return current;
	},
	/** Idempotent per slug; switching rooms leaves the old one first. */
	join(slug: string) {
		if (current?.slug === slug) return current;
		this.leave();
		current = connect(slug);
		return current;
	},
	/** The explicit act. Ends the ride, closes the socket, hangs up voice. */
	leave() {
		if (!current) return;
		// Before dispose: stop() closes the ride buffer and releases the
		// trainer, and both need the reactive scope the root is about to end.
		current.ride.stop();
		current.dispose();
		current.live.close();
		current.av.leave();
		current = null;
	},
};
