import { account } from '$lib/account.svelte';
import { fetchCrewsLive, type LiveCrew } from '$lib/crews-live';
import { announce } from '$lib/messages/announce';
import { shouldAnnounce } from '$lib/notify-once';
import { away } from '$lib/notify.svelte';
import { STALE_AFTER, readOrder } from '$lib/stale';
import type { LiveSession } from '$lib/protocol';
import { channelConnection } from '$lib/channel/connection.svelte';
import { crewArrivals, runningSessions } from './crew-arrivals';

/**
 * What is happening in the rider's crews, as the sidebar draws it (#2444,
 * #2447): per crew, the channels they may enter — who is in each voice
 * channel and what is running there, how much is unread in each text
 * channel — and the next plan. One read, again on every lobby ping, the way
 * the rest of the column re-reads. The shapes are `$lib/crews-live`'s.
 */
export type { LiveChannel, LiveCrew, LiveOccupant } from '$lib/crews-live';

let crews = $state<LiveCrew[]>([]);
let loaded = $state(false);
let error = $state<string | null>(null);
// Failed reads in a row, for the header's stale mark (#2518): a failed
// re-read keeps the last list on screen, so nothing else says it is old.
let failures = $state(0);
// Reads overlap on a busy lobby; an older one never lands over a newer one.
const order = readOrder();
// The first read is the state of the world, not a burst of arrivals: its
// sessions are old news and its lines are claimed, not announced (#2421).
let started = false;
let seen = new Set<string>();

async function load() {
	const mine = order.begin();
	const res = await fetchCrewsLive();
	if (!order.lands(mine)) return;
	if (!res.ok) {
		// A failed re-read keeps what is on screen; only a first read that
		// failed has nothing to show and says so.
		error = res.error.message;
		failures += 1;
		loaded = true;
		return;
	}
	crews = res.data.crews;
	error = null;
	failures = 0;
	loaded = true;
	const arrivals = crewArrivals(crews, seen, {
		here: location.pathname,
		connected: channelConnection.current?.address.channel || undefined,
		me: account.me?.id,
		looking: !away(),
	});
	seen = runningSessions(crews);
	const first = !started;
	started = true;
	for (const arrival of arrivals) {
		if (!first) announce(arrival);
		else if (arrival.kind === 'chat') shouldAnnounce(arrival.tag, arrival.at);
	}
}

export const crewLive = {
	get crews() {
		return crews;
	},
	get loaded() {
		return loaded;
	},
	get error() {
		return error;
	},
	get stale() {
		return failures >= STALE_AFTER;
	},
	crew(id: string): LiveCrew | undefined {
		return crews.find((c) => c.id === id);
	},
	reload: load,
	/** Signing out starts the world over: the next rider's first read is theirs. */
	reset() {
		order.reset();
		crews = [];
		loaded = false;
		error = null;
		failures = 0;
		started = false;
		seen = new Set();
	},
};

/** What a crew you are not looking at is doing (#1148), for its one line. */
export function livePulse(crew: LiveCrew | undefined) {
	const pulse = { riding: 0, voice: 0, unread: 0 };
	for (const c of crew?.channels ?? []) {
		pulse.unread += c.unread ?? 0;
		for (const o of c.occupants ?? []) {
			if (o.riding) pulse.riding += 1;
			if (o.voice) pulse.voice += 1;
		}
	}
	return pulse;
}

/** "Sweet Spot 2×20 · 12 min · Sven coaching · 4 riding" — what is running, how far in, who rides it. */
export function sessionLine(session: LiveSession): string {
	const minutes = Math.floor(session.elapsed / 60);
	const riders = session.riders.length;
	return [
		session.workout || 'A session',
		// A paused clock stands still (#2635): "12 min" read as running.
		session.phase === 'countdown'
			? 'starting'
			: session.phase === 'paused'
				? 'paused'
				: `${minutes} min`,
		// Who is coaching is presence (ADR-0058), not a number.
		`${session.coachName} coaching`,
		// The session's own riders (ADR-0059), said as what they are: a bare
		// number sat over the channel's occupants and read as a count of them
		// (#2853).
		`${riders} riding`,
	].join(' · ');
}
