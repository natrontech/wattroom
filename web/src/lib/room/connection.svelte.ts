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
import { comingsAndGoings } from '$lib/room/comings-and-goings';
import { screenShareChanges, screenShareEvent } from '$lib/room/screen-shares';
import { parseSharedWorkout } from '$lib/room/workout';
import { play } from '$lib/sound/cues';
import { setDucking } from '$lib/sound/duck';
import { shouldDuck } from '$lib/sound/ducking';
import { mixer } from '$lib/sound/mixer.svelte';
import { toasts } from '$lib/toast.svelte';
import { untrack } from 'svelte';
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
	/**
	 * You stepped out, or came back (#706). One home for the pair the state
	 * needs (#807): the local AV and the hub message.
	 */
	setAway: (next: boolean) => void;
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
	void api<{
		messages?: Parameters<typeof live.seedChat>[0];
		recaps?: Parameters<typeof live.seedRecaps>[0];
	}>(`/api/rooms/${slug}/chat`).then((res) => {
		if (!res.ok) return;
		if (res.data?.messages) live.seedChat(res.data.messages);
		// The room's finished sessions ride the same response (ADR-0034):
		// one question, one round trip, one membership gate.
		if (res.data?.recaps) live.seedRecaps(res.data.recaps);
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

		// Stepping out is a door too (#906). An away rider stays in the
		// roster, so the pair above never fires and a room of six can empty to
		// one in silence — the mark on their tile is on a screen nobody on a
		// bike is reading (ux.md). The same two cues a fifth down: the same
		// event, one layer in, and less final than actually leaving.
		//
		// Your own press is deliberately not special-cased: it arrives here
		// after `av.setAway` has already muted this device (#875), so going
		// away is silent — you pressed the button — and coming back is the
		// first thing you hear, which is the proof the room's sound is back.
		let knownAway: Map<string, boolean> | null = null;
		$effect(() => {
			const roster = live.tick?.roster;
			// A drop stops the ticks, so the roster on the other side is a
			// fresh observation, not a change — without this, reconnecting
			// announces the whole outage in one burst.
			if (live.status !== 'live' || !roster) {
				knownAway = null;
				return;
			}
			const before = knownAway;
			knownAway = new Map(roster.map((rider) => [rider.id, !!rider.away]));
			if (before === null) return;
			for (const rider of roster) {
				const was = before.get(rider.id);
				// A rider the last tick did not have is arriving, not coming
				// back: that is the cue above's event, not this one's.
				if (was === undefined || was === !!rider.away) continue;
				play(rider.away ? 'leave' : 'join', -7);
			}
		});

		// The voice channel says who arrived (#854). LiveKit chimes for
		// nobody, so a rider joined the call and you found out when they
		// spoke — or you did not. The room's own join/leave cannot stand in:
		// entering the room and entering the call are often hours apart.
		//
		// `tick.voice` and not `av.voice`: a client learns the roster from
		// LiveKit only once it has joined itself, so the local view of an
		// empty call is indistinguishable from a full one you have not
		// entered yet (protocol.go). The server's webhook answer is the only
		// one true for a rider who has not pressed Join.
		//
		// Pitched up a fifth: the same event as arriving in the room, one
		// layer in, and siblings should sound like siblings.
		let knownVoice: Set<string> | null = null;
		$effect(() => {
			const voice = live.tick?.voice;
			// A dropped room stops the ticks, so the roster on the other side
			// of a reconnect is a fresh observation, not a change — without
			// this, coming back announces the whole outage in one burst.
			if (live.status !== 'live' || !voice) {
				knownVoice = null;
				return;
			}
			const now = new Set(voice);
			const before = knownVoice;
			knownVoice = now;
			if (before === null) return;
			for (const change of comingsAndGoings(before, now, account.me?.id))
				play(change.live ? 'join' : 'leave', 7);
		});

		// Someone else's screen appearing announces itself (#664): while the
		// jukebox plays the stage stays on the music, so the share was one chip
		// in a picker nobody on a bike is watching. A local timeline line and
		// the join cue — something arrived in the room — through the mixer like
		// every other cue. Only while voice is live: a drop empties the list,
		// and every share would otherwise read as ended.
		let knownScreens = new Set<string>();
		$effect(() => {
			if (av.status !== 'live') return;
			const now = new Set(
				av.stageSources
					.filter((source) => source.kind === 'screen')
					.map((source) => source.id),
			);
			const changes = screenShareChanges(knownScreens, now, account.me?.id);
			knownScreens = now;
			if (changes.length === 0) return;
			// Untracked: the roster is a new object every tick, and this must
			// run when the shares change, not once a second.
			const tick = untrack(() => live.tick);
			for (const change of changes) {
				const name = tick?.roster.find(
					(rider) => rider.id === change.rider,
				)?.name;
				live.pushEvent(screenShareEvent(change, name, tick?.at ?? Date.now()));
				if (change.live) play('join');
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
		// The one caller (#988): the duck follows the CONNECTION, not whichever
		// page is mounted, and both the cue bus and the jukebox subscribe to
		// what it decides. Nothing here holds a timer — the hold and the
		// release live in the controller, where an effect re-running cannot
		// cancel them.
		$effect(() => {
			setDucking(shouldDuck(av.speaking, account.me?.id, mixer.duckSelf));
			// Leaving mid-sentence must not park the mix ducked forever.
			return () => setDucking(false);
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
		// fresh token — covers token expiry and transient drops (#219). It is
		// a resume, not a fresh join: the mic comes back the way it was, and
		// a rider who muted for a phone call stays muted (#641).
		let seenDrops = 0;
		$effect(() => {
			const drops = av.dropped;
			if (drops > seenDrops) {
				seenDrops = drops;
				setTimeout(() => {
					if (roomConnection.current?.slug === slug)
						void av.join({ mic: av.micBeforeDrop });
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
		/**
		 * You stepped out, or came back (#706). Local AV moves at once; the hub
		 * message makes the same state reach this rider's other screens and
		 * everyone watching. One home for the pair (#807) — the button that
		 * sends it now lives in the sidebar, which has no room context.
		 */
		setAway(next: boolean) {
			void av.setAway(next);
			live.setAway(next);
		},
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
	/**
	 * Ends the ride, closes the socket, hangs up voice. `'rider'` is the
	 * explicit act — they just pressed Leave, so it goes quietly. Anything
	 * else happened TO them, and a rider three metres from the screen learns
	 * about it by ear or not at all (ux.md): #850 is what one silent drop
	 * cost, a session that expired mid-click taking the room with it and
	 * nobody noticing. There is no dashboard left to hold a persistent
	 * status, so the toast carries the way back in.
	 */
	leave(reason: 'rider' | 'signedOut' = 'rider') {
		if (!current) return;
		const { slug } = current;
		const name = presence.rooms.find((room) => room.slug === slug)?.name;
		// Before dispose: stop() closes the ride buffer and releases the
		// trainer, and both need the reactive scope the root is about to end.
		current.ride.stop();
		current.dispose();
		current.live.close();
		current.av.leave();
		current = null;
		if (reason === 'rider') return;
		// The leave cue, not the fault buzz: the sound already means "someone
		// is out of the room", and an error-toned toast would sound its own.
		play('leave');
		toasts.push(`Your session ended — you left ${name ?? slug}.`, {
			href: `/r/${slug}`,
			seconds: 12,
		});
	},
};
