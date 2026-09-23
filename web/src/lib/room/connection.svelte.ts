import { account } from '$lib/account.svelte';
import { divertDmsWhileRiding } from '$lib/messages/announce';
import { shouldAnnounce } from '$lib/notify-once';
import { notify } from '$lib/notify.svelte';
import { createProfileStore } from '$lib/profile.svelte';
import { spaceBelongsTo } from '$lib/room/ptt-keys';
import { pullProfile } from '$lib/profile-sync.svelte';
import { createRoomLive } from '$lib/room/live.svelte';
import { createRecording } from '$lib/room/recording.svelte';
import { createRide } from '$lib/room/ride.svelte';
import { sensorClaim } from '$lib/channel/sensor-claim';
import { announcePoke } from '$lib/room/poke';
import { comingsAndGoings } from '$lib/room/comings-and-goings';
import { dmArrivalEvent } from '$lib/room/dm-line';
import { screenShareChanges, screenShareEvent } from '$lib/room/screen-shares';
import { parseSharedWorkout } from '$lib/workout/shared';
import { play } from '$lib/sound/cues';
import { setDucking } from '$lib/sound/duck';
import { shouldDuck } from '$lib/sound/ducking';
import { applyAway, noEcho, pressed } from '$lib/room/away-echo';

import { mixer } from '$lib/sound/mixer.svelte';
import { toasts } from '$lib/toast.svelte';
import { untrack } from 'svelte';
import type { SessionState } from '$lib/protocol';
import type { Segment, Workout } from '$lib/workout/types';
import { listening } from '$lib/room/listening.svelte';
import { onPlacePath, ridePath, type PlaceAddress } from '$lib/room/address';

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
	/** Where the connection stands, and every path that follows (#2449). */
	address: PlaceAddress;
	live: ReturnType<typeof createRoomLive>;
	av: RoomAv;
	/**
	 * You stepped out, or came back (#706). One home for the pair the state
	 * needs (#807): the local AV and the hub message.
	 */
	/** reason is one of $lib/away's keys; '' is the plain away. */
	setAway: (next: boolean, reason?: string) => void;
	/** The rider's FTP/weight cache, pulled from the account (ADR-0009). */
	profile: ReturnType<typeof createProfileStore>;
	/** What you rode this session — the ride writes it, the summary reads it. */
	recording: ReturnType<typeof createRecording>;
	/** The trainer, and the targets it holds. Lives here, not on a page (#521). */
	ride: ReturnType<typeof createRide>;
	/** The shared session and its workout, parsed once per connection. */
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	workout: () => Workout | null;
	dispose: () => void;
};

let current = $state<Connection | null>(null);

// The AV half loads with the room, not with the shell (#1514): av.svelte.ts
// and what it pulls — device choices, the mic chain, the stage — were the
// biggest thing the root layout's closure carried for routes that never join
// a room. The room layout's load awaits prepareRoomAv() before the shell
// mounts, so join() stays synchronous for everything that reads the
// connection the moment it exists.
type RoomAv = ReturnType<typeof import('$lib/room/av.svelte').createRoomAv>;
let createRoomAv: ((address: PlaceAddress) => RoomAv) | null = null;
export async function prepareRoomAv(): Promise<void> {
	if (createRoomAv) return;
	({ createRoomAv } = await import('$lib/room/av.svelte'));
}

function connect(address: PlaceAddress): Connection {
	if (!createRoomAv) {
		throw new Error(
			'the room AV is not loaded — the room layout prepares it before the shell joins',
		);
	}
	const live = createRoomLive(address);
	const av = createRoomAv(address);
	// Presence announces itself (#148) from HERE, not the page — someone
	// arriving is audible even while you are off browsing workouts; hidden
	// tabs get the browser notification instead (#202).
	let known: Set<string> | null = null;
	let lastPhase: string | null = null;
	// Assigned inside the root below, which runs synchronously.
	let profile!: ReturnType<typeof createProfileStore>;
	let recording!: ReturnType<typeof createRecording>;
	let ride!: ReturnType<typeof createRide>;
	let sharedOf!: () => SessionState | undefined;
	let segmentsOf!: () => Segment[];
	let workoutOf!: () => Workout | null;
	/**
	 * The away state this screen has asked for and not yet seen echoed
	 * (#1128), and when it asked. Null means "believe the roster". Outside the
	 * effect root because the button that writes it lives on the returned
	 * object, and the effect that reads it lives inside.
	 */
	/**
	 * What this screen pressed and has not yet seen echoed (#1128). Outside
	 * the effect root because the button that writes it lives on the returned
	 * object and the effect that reads it lives inside; the rule itself is in
	 * `away-echo.ts`, where it can be tested without an AV stack.
	 */
	let awayEcho = noEcho;

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
		//
		// It must not apply an echo of the state we just left (#1128). Our own
		// press is optimistic — local first, message second — and the tick
		// already in flight still carries the OLD value. Applying it ran the
		// come-back branch a fifth of a second after the rider pressed Away:
		// the mix unmuted and the mic re-opened itself, so the button read as
		// doing nothing while the room went on hearing them.
		//
		// So a press records what it is waiting for, and the roster is ignored
		// until it agrees — bounded, so a message the server never answers
		// cannot pin this rider's away state to a wish forever. `away-echo.ts`
		// holds the rule and its tests; this is the two lines that call it.
		// A reconnect re-declares away on open (live.svelte.ts), but the hub
		// dropped it with the last socket and a tick in between says
		// away:false — with nothing pressed, the echo was unarmed and that
		// tick re-opened the camera of a rider not at the bike (#1740). Arm
		// it as a press, so the first ticks that disagree are waited out.
		let wasLive = live.status === 'live';
		$effect(() => {
			const nowLive = live.status === 'live';
			if (nowLive && !wasLive && av.away) awayEcho = pressed(true);
			wasLive = nowLive;
		});
		$effect(() => {
			const mine = live.tick?.roster.find(
				(rider) => rider.id === account.me?.id,
			);
			if (!mine) return;
			const server = !!mine.away;
			const step = applyAway(server, awayEcho);
			awayEcho = step.echo;
			if (!step.apply) return;
			void av.setAway(server);
		});

		$effect(() => {
			const roster = live.tick?.roster ?? [];
			const ids = new Set(roster.map((rider) => rider.id));
			// Coming back announces the whole outage in one burst otherwise
			// (#1741) — the away and voice effects below already forget.
			if (live.status !== 'live') {
				known = null;
				return;
			}
			if (known === null) {
				known = ids;
				return;
			}
			const before = known;
			known = ids;
			const arrived = roster.filter((rider) => !before.has(rider.id));
			const at = live.tick?.at ?? Date.now();
			if (arrived.length > 0) {
				// Once per tag across tabs, and the room's name, not its slug.
				if (!shouldAnnounce(`join-${address.key}-${at}`, at)) return;
				play('join');
				notify.push(
					address.name,
					`${arrived.map((rider) => rider.name).join(', ')} joined the room`,
					`join-${address.key}`,
					{ href: address.home },
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

		// A DM arriving while this rider is mid-ride (#1743). The toast it
		// replaces was the only thing on the Training screen that moved and
		// was not data; the line lands in the room's timeline instead, where
		// "what did I miss" is already answered — local-only and never sent
		// (ADR-0022), so a private message reaches nobody else in the room.
		//
		// Running or paused, not merely countdown: the count-in is a rider
		// still walking back to the bike, and auto-pause is a rider reaching
		// for a bottle mid-interval, not a rider who has finished.
		$effect(() =>
			divertDmsWhileRiding((arrival) => {
				// Read outside the announcing caller's reactivity: the tick is a
				// new object every second, and this must not become a dependency
				// of whatever effect happened to be running when a DM landed.
				const phase = untrack(() => live.tick?.state.phase);
				if (phase !== 'running' && phase !== 'paused') return false;
				live.pushEvent(dmArrivalEvent(arrival.title, arrival.at));
				return true;
			}),
		);

		// A poke is delivered to every socket of this rider. localStorage picks
		// one tab on each device to make the sound/notification, while each
		// device still receives it independently. play() keeps the receiver's
		// cue fader authoritative; notify.push() keeps their permission and the
		// hidden-tab gate authoritative.
		$effect(() => {
			const poke = live.lastPoke;
			announcePoke(poke, address.key, address.name, address.home);
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

		// PTT keys work on EVERY page while in voice — and a keyup lost to
		// navigation or focus loss must never leave the mic hot (audit #219).
		$effect(() => {
			if (typeof window === 'undefined') return;
			const key = (event: KeyboardEvent, held: boolean) => {
				if (av.mode !== 'ptt' || event.code !== 'Space') return;
				// A text field, or a control the keyboard is on, keeps its
				// Space (ptt-keys.ts, audit 2026-09-09).
				if (spaceBelongsTo(event.target)) return;
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
					if (roomConnection.current?.address.key === address.key)
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
				const at = live.tick?.at ?? Date.now();
				if (shouldAnnounce(`session-${address.key}-${at}`, at))
					notify.push(
						address.name,
						'The session is starting — saddle up',
						`session-${address.key}`,
						{ href: ridePath(address, live.tick?.state.id) },
					);
			}
		});
	});
	return {
		address,
		live,
		av,
		/**
		 * You stepped out, or came back (#706). Local AV moves at once; the hub
		 * message makes the same state reach this rider's other screens and
		 * everyone watching. One home for the pair (#807) — the button that
		 * sends it now lives in the sidebar, which has no room context.
		 */
		setAway(next: boolean, reason = '') {
			// What we are waiting for the server to echo (#1128), so the tick
			// already in flight cannot undo the press that produced it. The
			// echo tracks away-ness alone: the reason changes no mic and no
			// camera, so AV never hears about it.
			awayEcho = pressed(next);
			void av.setAway(next);
			live.setAway(next, reason);
		},
		profile,
		recording,
		ride,
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
	/**
	 * Whether `pathname` is one of the live place's own pages — its Lounge,
	 * its Training, the session running in it (`onPlacePath`, #2460).
	 */
	onPlacePath(pathname: string): boolean {
		return (
			!!current &&
			onPlacePath(pathname, current.address, current.live.tick?.state.id)
		);
	},
	/** Idempotent per place; switching places leaves the old one first. */
	join(address: PlaceAddress) {
		if (current?.address.key === address.key) return current;
		this.leave();
		current = connect(address);
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
		const { address } = current;
		const name = address.name;
		// Before dispose: stop() closes the ride buffer and releases the
		// trainer, and both need the reactive scope the root is about to end.
		current.ride.stop();
		current.dispose();
		current.live.close();
		current.av.leave();
		// Being out of the music is for this room, this sitting (#1898): the
		// next room's dock must not open on "the room is listening" with the
		// player unloaded.
		listening.rejoin();
		current = null;
		if (reason === 'rider') return;
		// The leave cue, not the fault buzz: the sound already means "someone
		// is out of the room", and an error-toned toast would sound its own.
		play('leave');
		toasts.push(`Your session ended — you left ${name}.`, {
			href: address.home,
			seconds: 12,
		});
	},
};
