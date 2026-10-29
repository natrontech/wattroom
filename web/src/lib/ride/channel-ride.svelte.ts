import { account } from '$lib/account.svelte';
import type { RoadPlace } from '$lib/channel/road-place';
import type { createChannelLive } from '$lib/channel/live.svelte';
import type { createProfileStore } from '$lib/profile.svelte';
import {
	createFreeRide,
	type FreeRideOutcome,
} from '$lib/ride/free-ride.svelte';
import { createOwnRide, type OwnRideOutcome } from '$lib/ride/own-ride.svelte';
import type { SessionState } from '$lib/protocol';
import type { createRecording } from '$lib/session/recording.svelte';
import { createRide } from '$lib/session/ride.svelte';
import { toasts } from '$lib/toast.svelte';
import { createSignalWatch } from '$lib/workout/signal-watch.svelte';
import type { Segment } from '$lib/workout/types';

/**
 * A voice channel's ride (ADR-0093, #4259): the trainer the channel rides,
 * its free ride and your own workout, held by `theRide` in an effect root of
 * their own rather than by the connection's. The trainer is the ride's; a
 * joined session only feeds it targets. Its numbers still go to the call it
 * was held for, and leaving that call ends it (`end`), until the audience
 * follows the rider (ADR-0093 point 6).
 */
export function holdChannelRide(deps: {
	live: ReturnType<typeof createChannelLive>;
	profile: ReturnType<typeof createProfileStore>;
	recording: ReturnType<typeof createRecording>;
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	road: () => RoadPlace | null;
	joined: () => boolean;
}) {
	const { live, profile, joined } = deps;
	let free!: ReturnType<typeof createFreeRide>;
	let ride!: ReturnType<typeof createRide>;
	let own!: ReturnType<typeof createOwnRide>;
	let signal!: ReturnType<typeof createSignalWatch>;

	const dispose = $effect.root(() => {
		free = createFreeRide({
			ftp: () => profile.current.ftp,
			singleSpeed: () => profile.current.singleSpeed,
			kg: () => profile.current.kg,
		});
		ride = createRide({
			live,
			profile,
			recording: deps.recording,
			myId: () => account.me?.id,
			shared: deps.shared,
			segments: deps.segments,
			road: deps.road,
			joined,
			free,
		});
		own = createOwnRide({
			ride,
			live,
			profile,
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
	});

	return {
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

/** The call's ride, held while the rider is in it; `theRide.channel` reads it. */
export const channelRide = {
	get current() {
		return current;
	},
	hold(deps: Parameters<typeof holdChannelRide>[0]): ChannelRide {
		current?.end();
		current = holdChannelRide(deps);
		return current;
	},
	/** Leaving the call ends its ride, saved, until the audience follows the rider. */
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
