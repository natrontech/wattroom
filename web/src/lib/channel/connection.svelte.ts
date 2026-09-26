import { account } from '$lib/account.svelte';
import { createProfileStore } from '$lib/profile.svelte';
import { spaceBelongsTo } from '$lib/channel/ptt-keys';
import { pullProfile } from '$lib/profile-sync.svelte';
import { createChannelLive } from '$lib/channel/live.svelte';
import { createRecording } from '$lib/session/recording.svelte';
import { createRide } from '$lib/session/ride.svelte';
import {
	createFreeRide,
	type FreeRide,
	type FreeRideOutcome,
} from '$lib/ride/free-ride.svelte';
import { sensorClaim } from '$lib/channel/sensor-claim';
import { parseSharedWorkout } from '$lib/workout/shared';
import { play } from '$lib/sound/cues';
import { applyAway, noEcho, pressed } from '$lib/channel/away-echo';
import { connectionCues } from '$lib/channel/connection-cues.svelte';
import { followMoves } from '$lib/channel/follow-move.svelte';
import { toasts } from '$lib/toast.svelte';
import type { SessionState } from '$lib/protocol';
import type { Segment, Workout } from '$lib/workout/types';
import { listening } from '$lib/channel/listening.svelte';
import { onPlacePath, type PlaceAddress } from '$lib/channel/address';
import { isLivePhase } from '$lib/channel/tick-session';

/**
 * The voice channel you are IN (#173, ADR-0010's logical end): joining is a
 * STATE, not a page. The WS presence and the voice connection live here,
 * above the router — open /workouts, run a ramp test, ride solo, and you are
 * still in your voice channel, exactly like idling in a Discord server.
 * Leaving is an explicit act, never a navigation side-effect.
 *
 * One channel at a time: joining another leaves the first — you cannot stand
 * in two lounges.
 */
type Connection = {
	/** Where the connection stands, and every path that follows (#2449). */
	address: PlaceAddress;
	live: ReturnType<typeof createChannelLive>;
	av: ChannelAv;
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
	/** Riding the channel with no session (ADR-0059) — beside the trainer. */
	freeRide: FreeRide;
	/** You are riding the channel's session, not standing beside it. */
	joined: () => boolean;
	/**
	 * A ride is under way on this connection: a session live in the channel,
	 * or your free ride recording (ADR-0059, #2843). What the frame darkens
	 * for, the HUD follows and the leave guard protects.
	 */
	riding: () => boolean;
	/** The shared session and its workout, parsed once per connection. */
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	workout: () => Workout | null;
	dispose: () => void;
};

let current = $state<Connection | null>(null);

// The AV half loads with the channel, not with the shell (#1514): av.svelte.ts
// and what it pulls — device choices, the mic chain, the stage — were the
// biggest thing the root layout's closure carried for routes that never join
// a channel. The voice channel's and the session's layouts await
// prepareChannelAv() before the shell mounts, so join() stays synchronous
// for everything that reads the connection the moment it exists.
type ChannelAv = ReturnType<
	typeof import('$lib/channel/av.svelte').createChannelAv
>;
let createChannelAv: ((address: PlaceAddress) => ChannelAv) | null = null;
export async function prepareChannelAv(): Promise<void> {
	if (createChannelAv) return;
	({ createChannelAv } = await import('$lib/channel/av.svelte'));
}

function connect(address: PlaceAddress): Connection {
	if (!createChannelAv) {
		throw new Error(
			'the channel AV is not loaded — the channel layout prepares it before the shell joins',
		);
	}
	const live = createChannelLive(address);
	const av = createChannelAv(address);
	// Assigned inside the root below, which runs synchronously.
	let profile!: ReturnType<typeof createProfileStore>;
	let recording!: ReturnType<typeof createRecording>;
	let ride!: ReturnType<typeof createRide>;
	let freeRide!: FreeRide;
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

	/** You are riding the channel's session, not standing beside it. */
	const joined = () =>
		!!live.tick?.roster.find((r) => r.id === account.me?.id)?.inSession;

	const dispose = $effect.root(() => {
		// The trainer belongs to the connection, not to a page (#521). It is a
		// property of standing in the channel, exactly like the socket and the
		// call — and the channel's shell unmounting on the way to /workouts
		// used to disconnect it while you were still in the channel.
		//
		// It also gives the metrics stream one `seq` per session (#522): a
		// per-mount counter restarted at 1, and the server's ride record
		// dedupes by seq, so every sample after a return to the channel was
		// dropped as a duplicate. The tiles kept moving, which is why it read
		// as half-working; the execution meter and the saved ride did not.
		profile = createProfileStore();
		recording = createRecording();
		// The account is the truth for FTP and weight (ADR-0009). The root
		// layout pulls on boot; a connection that outlives many pages has to
		// pull too, or a ramp-measured FTP never reaches the session's targets.
		$effect(() => {
			if (account.me) pullProfile(profile);
		});

		const shared = $derived(live.tick?.state);
		const parsed = $derived(parseSharedWorkout(shared?.workoutJson));
		sharedOf = () => shared;
		segmentsOf = () => parsed.segments;
		workoutOf = () => parsed.workout;
		// Here and not in a page: the recording outlives every page (#2654).
		$effect(() => recording.follow(shared?.phase));

		freeRide = createFreeRide({ ftp: () => profile.current.ftp });
		ride = createRide({
			live,
			profile,
			recording,
			myId: () => account.me?.id,
			shared: () => shared,
			segments: () => parsed.segments,
			joined,
			free: freeRide,
		});
		// Joining a session saves the free ride first (docs/SPEC.md): the
		// session's trainer and record take over from here. On the step in,
		// not on being in: the roster says "in" for a tick after Leave the
		// ride, and a Free ride opened in that tick would be ended at once.
		let wasJoined = false;
		$effect(() => {
			const now = joined();
			if (now && !wasJoined && freeRide.armed)
				void freeRide.end().then(sayFreeRide);
			wasJoined = now;
		});

		// One sensor, one screen (#610). The claim belongs to the CONNECTION
		// for the same reason the trainer does: it has to survive the channel's
		// shell unmounting on the way to another page, or a walk to /workouts
		// would hand the rider's own trainer back to their phone.
		$effect(() => {
			live.claimSensors(sensorClaim(ride.trainer !== null));
		});

		// Away is per rider in the hub (#706), so every one of that rider's
		// screens follows the roster truth. The tab that pressed the button
		// updates itself immediately in ChannelShell; this is what also mutes the
		// desktop when the phone pressed it, and restores each tab to what that
		// tab had live before.
		//
		// It must not apply an echo of the state we just left (#1128). Our own
		// press is optimistic — local first, message second — and the tick
		// already in flight still carries the OLD value. Applying it ran the
		// come-back branch a fifth of a second after the rider pressed Away:
		// the mix unmuted and the mic re-opened itself, so the button read as
		// doing nothing while the call went on hearing them.
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

		// Everything the connection says out loud (connection-cues.svelte.ts).
		connectionCues({ address, live, av });
		followMoves({ address, live, av });

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
					if (channelConnection.current?.address.key === address.key)
						void av.join({ mic: av.micBeforeDrop });
				}, 2_000);
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
		 * sends it now lives in the sidebar, which has no channel context.
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
		freeRide,
		joined,
		riding: () => isLivePhase(live.tick?.state.phase) || freeRide.recording,
		shared: sharedOf,
		segments: segmentsOf,
		workout: workoutOf,
		dispose,
	};
}

/**
 * A free ride saved off-screen — on joining a session, or on leaving the
 * channel — says so, since no Free ride page is there to (errors.md: a
 * background action's result is a toast). A failure stays in the crash
 * buffer, which the solo ride's setup offers back.
 */
function sayFreeRide(outcome: FreeRideOutcome | null) {
	if (!outcome || 'short' in outcome) return;
	if ('saved' in outcome)
		toasts.push('Your free ride is saved.', {
			href: `/history/${outcome.saved.id}`,
		});
	else
		toasts.push(
			`Your free ride did not save — ${outcome.failure.message} It is kept on this device, and Ride offers it again.`,
			{ tone: 'error', href: '/ride', seconds: 0 },
		);
}

export const channelConnection = {
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
	/**
	 * A ride is held — a free ride, or the session you joined — and `pathname`
	 * is not its place (#2885): the place's own shell carries the ride's status
	 * and is not mounted here, so the frame has to.
	 */
	ridingAway(pathname: string): boolean {
		return (
			!!current &&
			(current.freeRide.recording || current.joined()) &&
			!this.onPlacePath(pathname)
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
	 * cost, a session that expired mid-click taking the channel with it and
	 * nobody noticing. There is no dashboard left to hold a persistent
	 * status, so the toast carries the way back in.
	 */
	leave(reason: 'rider' | 'signedOut' = 'rider') {
		if (!current) return;
		const { address } = current;
		const name = address.name;
		// A free ride nobody ended is saved on the way out — the rider left
		// the channel, not the ride. Its answer arrives after the page has gone.
		void current.freeRide.end().then(sayFreeRide);
		// Before dispose: stop() closes the ride buffer and releases the
		// trainer, and both need the reactive scope the root is about to end.
		current.ride.stop();
		current.dispose();
		current.live.close();
		current.av.leave();
		// Being out of the music is for this channel, this sitting (#1898): the
		// next channel's dock must not open on "everyone else is listening" with
		// the player unloaded.
		listening.rejoin();
		current = null;
		if (reason === 'rider') return;
		// The leave cue, not the fault buzz: the sound already means "someone
		// is out of the channel", and an error-toned toast would sound its own.
		play('leave');
		// Signed out is the one reason there is (#2634): "your session ended"
		// read as the ride's session, which a rider in the lounge had none of.
		toasts.push(`You were signed out — you left ${name}.`, {
			href: address.home,
			seconds: 12,
		});
	},
};
