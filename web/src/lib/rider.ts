/**
 * A rider's page (ADR-0024): the `/api/riders/{id}` shape and the prose the
 * page makes of it. The numbers here are sums a crew already shows —
 * never live watts, heart rate, weight or FTP.
 */
import { api, loadApi } from '$lib/api';
import { formatDuration } from '$lib/format';
import type { VoicePlace } from '$lib/whereabouts';

export interface CrewRef {
	id: string;
	name: string;
}

export interface SharedRide {
	id: string;
	workoutName: string;
	startedAt: string;
	seconds: number;
	kj: number;
	execution: number;
	/** False when the workout prescribed nothing — a sprint session, a freeride. */
	executionScored?: boolean;
	/** docs/SPEC.md medal kinds won on this ride. */
	medals?: string[];
	inRoom: boolean;
	/** The voice channel's name, only when you may enter it. */
	roomName?: string;
}

export interface Rider {
	id: string;
	displayName: string;
	avatarUrl?: string;
	since: string;
	totalXp: number;
	totalKj: number;
	rides: number;
	/** kind → count, scoped to the crews in common. */
	medals: Record<string, number>;
	/** The crews where you may both enter a channel — the medals' scope. */
	crewsInCommon: CrewRef[];
	/**
	 * `whereabouts` reads it. A friend (or you) hears online and in-voice as
	 * the friends list does; a crew-mate hears only about a channel they may
	 * enter themselves. The channel, and riding, only when you may enter it.
	 */
	presence: {
		online: boolean;
		inVoice: boolean;
		riding: boolean;
		channel?: VoicePlace;
	};
	friend: 'self' | 'none' | 'pending_in' | 'pending_out' | 'accepted';
	canAdd: boolean;
	/** Friends and yourself only; null otherwise. */
	month: { rides: number; seconds: number; kj: number } | null;
	sharedRides: SharedRide[] | null;
}

export function fetchRider(id: string, fetcher?: typeof fetch) {
	const path = `/api/riders/${id}`;
	return fetcher ? loadApi<Rider>(fetcher, path) : api<Rider>(path);
}

/** "48 min · 612 kJ · 96% on target" — one line per shared ride. */
export function rideLine(
	ride: Pick<SharedRide, 'seconds' | 'kj' | 'execution' | 'executionScored'>,
): string {
	const head = `${formatDuration(ride.seconds)} · ${ride.kj.toLocaleString()} kJ`;
	// A workout with nothing to score is not "0 % on target" (#1143).
	if (ride.executionScored === false) return head;
	return `${head} · ${Math.round(ride.execution * 100)}% on target`;
}

/** "9 h 40 · 6,810 kJ" — the month tile's hint. */
export function monthLine(month: { seconds: number; kj: number }): string {
	return `${formatDuration(month.seconds)} · ${month.kj.toLocaleString()} kJ`;
}

/** Where the ride happened, for the line after its name. */
export function ridePlace(
	ride: Pick<SharedRide, 'inRoom' | 'roomName'>,
): string {
	if (ride.roomName) return ride.roomName;
	return ride.inRoom ? 'in a session' : 'solo';
}

export function medalTotal(medals: Record<string, number>): number {
	return Object.values(medals).reduce((sum, n) => sum + n, 0);
}
