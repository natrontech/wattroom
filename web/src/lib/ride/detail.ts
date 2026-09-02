/**
 * One past ride, opened (#503). The Rides list is summaries; this is the
 * single blob read ADR-0016 keeps the samples for — the shape the server
 * sends, and the two calls the detail page and the list row share.
 */
import { api, type ApiResult } from '$lib/api';
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
	ftp: number;
	xp: number;
	/** The room it was ridden in, or null for a solo ride. */
	room: { slug: string; name: string } | null;
	medals: RideMedal[];
	/** Empty when the stored blob could not be read — the numbers still hold. */
	samples: RideTraceSample[];
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
