import { fetchCrewsLive, type LiveCrew } from '$lib/crews-live';
import type { LiveSession } from '$lib/protocol';

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
// Reads overlap on a busy lobby; only the newest may land.
let issued = 0;

async function load() {
	const mine = ++issued;
	const res = await fetchCrewsLive();
	if (mine !== issued) return;
	if (!res.ok) {
		// A failed re-read keeps what is on screen; only a first read that
		// failed has nothing to show and says so.
		error = res.error.message;
		loaded = true;
		return;
	}
	crews = res.data.crews;
	error = null;
	loaded = true;
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
	crew(id: string): LiveCrew | undefined {
		return crews.find((c) => c.id === id);
	},
	reload: load,
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

/** "Sweet Spot 2×20 · 12 min · 4" — what is running, how far in, how many. */
export function sessionLine(session: LiveSession): string {
	const minutes = Math.floor(session.elapsed / 60);
	const riders = session.riders.length;
	return [
		session.workout || 'A session',
		session.phase === 'countdown' ? 'starting' : `${minutes} min`,
		String(riders),
	].join(' · ');
}
