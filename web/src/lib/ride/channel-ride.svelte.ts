import { account } from '#lib/account.svelte.ts';
import type { RoadPlace } from '#lib/channel/road-place.ts';
import type { createChannelLive } from '#lib/channel/live.svelte.ts';
import type { createProfileStore } from '#lib/profile.svelte.ts';
import {
	createFreeRide,
	type FreeRideOutcome,
} from '#lib/ride/free-ride.svelte.ts';
import {
	createOwnRide,
	type OwnRideOutcome,
} from '#lib/ride/own-ride.svelte.ts';
import type { SessionState } from '#lib/protocol.ts';
import type { createRecording } from '#lib/session/recording.svelte.ts';
import { createRide } from '#lib/session/ride.svelte.ts';
import { toasts } from '#lib/toast.svelte.ts';
import { createSignalWatch } from '#lib/workout/signal-watch.svelte.ts';
import type { Segment } from '#lib/workout/types.ts';

/** What a ride rides on: the socket and the session state of one place. */
export type ChannelRideDeps = {
	live: ReturnType<typeof createChannelLive>;
	profile: ReturnType<typeof createProfileStore>;
	recording: ReturnType<typeof createRecording>;
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	road: () => RoadPlace | null;
	joined: () => boolean;
};

/**
 * A voice channel's ride (ADR-0093, #4259): the trainer the channel rides,
 * its free ride and your own workout, held by `theRide` in an effect root of
 * their own rather than by the connection's. The trainer is the ride's; a
 * joined session only feeds it targets. It rides on one place's socket at a
 * time, and `move` takes it to another place still running: the next voice
 * channel, a crew session, and back to the call.
 */
export function holdChannelRide(first: ChannelRideDeps) {
	// The place the ride rides on. Read through, never copied, so a move
	// re-runs whatever reads the socket, the tick or the roster.
	let on = $state.raw(first);
	const via = {
		get live() {
			return on.live;
		},
		get profile() {
			return on.profile;
		},
		get recording() {
			return on.recording;
		},
		shared: () => on.shared(),
		segments: () => on.segments(),
		road: () => on.road(),
		joined: () => on.joined(),
	};
	// Riding together (docs/SESSIONS.md) the rider is in the session and the
	// free ride still drives the trainer: no workout gives targets. Only a
	// session with one takes the trainer over.
	const together = () => !!via.shared()?.together;
	const joined = () => via.joined() && !together();
	let free!: ReturnType<typeof createFreeRide>;
	let ride!: ReturnType<typeof createRide>;
	let own!: ReturnType<typeof createOwnRide>;
	let signal!: ReturnType<typeof createSignalWatch>;

	const dispose = $effect.root(() => {
		free = createFreeRide({
			ftp: () => via.profile.current.ftp,
			singleSpeed: () => via.profile.current.singleSpeed,
			kg: () => via.profile.current.kg,
		});
		ride = createRide({
			get live() {
				return via.live;
			},
			get profile() {
				return via.profile;
			},
			get recording() {
				return via.recording;
			},
			myId: () => account.me?.id,
			shared: via.shared,
			segments: via.segments,
			road: via.road,
			joined,
			free,
		});
		own = createOwnRide({
			ride,
			get live() {
				return via.live;
			},
			get profile() {
				return via.profile;
			},
			joined,
			endFreeRide: () => free.end().then(sayFreeRide),
		});
		signal = createSignalWatch(() => own.session);
		// Joining a session saves the free ride first (docs/SPEC.md): the
		// session's trainer and record take over from here. On the step in,
		// not on being in: the roster says "in" for a tick after Leave the
		// ride, and a Free ride opened in that tick would be ended at once.
		let wasJoined = false;
		$effect(() => {
			const now = joined();
			if (now && !wasJoined && free.armed) void free.end().then(sayFreeRide);
			wasJoined = now;
		});
		// In a session with no workout, the free ride is the ride.
		$effect(() => {
			if (via.joined() && together() && !free.armed) free.arm();
		});
	});

	return {
		/** The socket the ride rides on: the connection that holds it. */
		get live() {
			return on.live;
		},
		/**
		 * Ride on another place from here, still running: only the socket the
		 * numbers go to changes. The old socket's session buffer is settled,
		 * as leaving that session settled it.
		 */
		move(to: ChannelRideDeps) {
			if (to.live === on.live) return;
			on.live.finish();
			on = to;
		},
		ride,
		freeRide: free,
		ownRide: own,
		/** Counting in or riding: the device's one ride is this one. */
		get riding() {
			return free.recording || own.riding;
		},
		/** Time ridden, for the dock: your workout's clock, or the free ride's. */
		get seconds(): number {
			return own.riding ? (own.session?.elapsed ?? 0) : free.seconds;
		},
		get watts(): number {
			return own.riding ? (own.session?.sample?.watts ?? 0) : ride.watts;
		},
		/** The trainer went quiet: the watts are not live. */
		get stale(): boolean {
			return own.riding ? signal.lost : ride.fault !== null;
		},
		/** Leaving the call: the free ride and your workout are saved, the trainer let go. */
		end() {
			void free.end().then(sayFreeRide);
			void own.leave().then(sayOwnRide);
			// Before dispose: stop() closes the ride buffer and releases the
			// trainer, and both need the reactive scope the root is about to end.
			ride.stop();
			dispose();
		},
	};
}

export type ChannelRide = ReturnType<typeof holdChannelRide>;

let current = $state.raw<ChannelRide | null>(null);

/** The device's ride in a place, held while the rider is in one; `theRide.channel` reads it. */
export const channelRide = {
	get current() {
		return current;
	},
	/**
	 * The device's ride, riding on `deps`' place: made when there is none,
	 * moved there when there is (#4259). A crew session taking it from the
	 * call, or the next voice channel from the last, keeps the trainer
	 * connected, the free ride recording and your own workout on its block.
	 */
	hold(deps: ChannelRideDeps): ChannelRide {
		if (current) current.move(deps);
		else current = holdChannelRide(deps);
		return current;
	},
	/** The ride ends, saved, and the trainer lets go: no place is left to ride it on. */
	leave() {
		current?.end();
		current = null;
	},
};

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

/** Your own workout, saved on the way out of the channel — sayFreeRide's rule. */
function sayOwnRide(outcome: OwnRideOutcome | null) {
	if (!outcome || 'nothing' in outcome) return;
	if ('saved' in outcome)
		toasts.push('Your ride is saved.', {
			href: outcome.saved ? `/history/${outcome.saved}` : undefined,
		});
	else
		toasts.push(
			`Your ride did not save — ${outcome.failure.message} It is kept on this device, and Ride offers it again.`,
			{ tone: 'error', href: '/ride', seconds: 0 },
		);
}
