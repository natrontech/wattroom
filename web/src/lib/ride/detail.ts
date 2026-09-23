import type { RidePlace } from './list';
/**
 * One past ride, opened (#503). The Rides list is summaries; this is the
 * single blob read ADR-0016 keeps the samples for — the shape the server
 * sends, and the two calls the detail page and the list row share.
 */
import { api, type ApiResult } from '$lib/api';
import type { RideFeel } from './feel';
import type { RideSample } from './stats';

export interface RideMedal {
	/** docs/SPEC.md kind — names come from $lib/medals, never retyped. */
	kind: string;
	roomName: string;
	awardedAt: string;
}

/** A saved ride's per-second sample; hr and cadence only where it had them. */
export interface RideTraceSample extends RideSample {
	hr?: number;
	cadence?: number;
}

export interface RideDetail {
	id: string;
	workoutName: string;
	startedAt: string;
	seconds: number;
	avgWatts: number;
	normWatts: number;
	kj: number;
	execution: number;
	/** #1143: false when the workout prescribed nothing to score. */
	executionScored?: boolean;
	ftp: number;
	xp: number;
	/** Per-ride opt-in (ADR-0024): shown and flipped on the page (#1691). */
	sharedWithFriends: boolean;
	/** The ride's own power curve (SPEC), absent when none was stored. */
	curve?: { best5s: number; best1m: number; best5m: number; best20m: number };
	/** The room a ride from before channels (#2443) was ridden in; else null. */
	room: { slug: string; name: string } | null;
	/** Where it was ridden (#2443); absent for a solo ride. */
	crew?: RidePlace;
	channel?: RidePlace;
	medals: RideMedal[];
	/** Empty when the stored blob could not be read — the numbers still hold. */
	samples: RideTraceSample[];
	/** Where the ride was sent, if anywhere — absent when nobody tried (#799). */
	export?: RideExport;
	/**
	 * What the rider said about the ride (#2328) — both halves null until
	 * they do. This is the only read that carries them: ADR-0055 keeps the
	 * note off every surface but the owner's own and the account export.
	 */
	feel: RideFeel;
}

/** One destination's delivery, as the server durably remembers it. */
export interface RideExport {
	destination: string;
	state: 'pending' | 'delivered' | 'failed';
	/** The remote's own id, once it has one. */
	remoteId?: number;
	/** The last failure, while it is still failing. */
	error?: string;
	/**
	 * When the ride outgrew this delivery (#2281) — absent unless it did. A
	 * late reconnect can grow a ride after its session closed (#1536), and a
	 * delivery that already succeeded is never re-sent, so the remote keeps
	 * the shorter version from this moment on.
	 */
	staleSince?: string;
}

export function fetchRide(id: string): Promise<ApiResult<RideDetail>> {
	return api<RideDetail>(`/api/rides/${encodeURIComponent(id)}`);
}

/** Irreversible: the samples live nowhere else. Confirmed before it is called. */
export function deleteRide(id: string): Promise<ApiResult<void>> {
	return api<void>(`/api/rides/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	});
}
