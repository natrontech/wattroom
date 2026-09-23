import { toleranceBand } from '$lib/workout/guards';

/**
 * The room screen's view model (#39's design, made real): one rider shape the
 * designed components render, fed by live ticks instead of the mock generator.
 * The dev mock produces the same shape, which is what keeps /dev/room honest.
 */
export interface LiveRider {
	id: string;
	name: string;
	ftp: number;
	kg: number;
	you: boolean;
	coach: boolean;
	cameraOn: boolean;
	/** Their screen is live in the room (#664) — marked on the tile, since the stage need not move. */
	sharing?: boolean;
	/** A soundboard clip of theirs is playing on THIS machine right now (#1681). */
	sounding?: boolean;
	/** In the voice channel at all — absent mic ≠ muted mic (#151). */
	inVoice?: boolean;
	muted: boolean;
	speaking: boolean;
	/** The rider explicitly stepped out; presence, never inferred from watts. */
	away?: boolean;
	/** Which away, from $lib/away's keys; '' or absent is the plain one. Room
	 * surfaces only — outside a room the reason is not carried at all. */
	awayReason?: string;
	/** Pedalling inside the room's window (#1016) — the server's word, not this
	 * tile's reading of the current sample. A coast holds it. */
	riding?: boolean;
	/** camera-off fallback hue, so the grid isn't uniformly dark */
	hue: number;
	watts: number;
	cadence: number;
	hr: number;
	/** their trainer stopped reporting — numbers are last-known, not live */
	stale: boolean;
	target: number;
	/** The live score; absent until something scorable was ridden (#1454). */
	execution?: number;
	trace: { t: number; w: number }[];
	eliminated?: boolean;
}

/**
 * A room's member as the room's own screens render them. The tick's roster is
 * the live truth and carries no faces; this is who the room HAS, which is also
 * the only way to know who is not here.
 */
export interface RoomMember {
	id: string;
	displayName: string;
	avatarUrl?: string;
	totalXp?: number;
}

export type TileMetric = 'hr' | 'cadence' | 'wkg';
export const TILE_METRICS: { id: TileMetric; label: string }[] = [
	{ id: 'hr', label: 'bpm' },
	{ id: 'cadence', label: 'rpm' },
	{ id: 'wkg', label: 'w/kg' },
];

export function targetState(rider: Pick<LiveRider, 'watts' | 'target'>) {
	const has = rider.target > 0;
	// One band, docs/SPEC.md's, shared with the scorer through the generated
	// protocol (#2159). This file used to carry its own copy of the formula.
	const band = has ? toleranceBand(rider.target) : 0;
	const delta = rider.watts - rider.target;
	return { has, band, delta, inBand: has && Math.abs(delta) <= band };
}

// The shapes the designed components share with the sidebar (moved from the
// mockcompat barrel, consolidation sweep 2026-09-09: one import path each).
/** Presence phases as the designed components speak them. */
export type Phase = 'lounge' | 'countdown' | 'live';

export interface Fault {
	/** 'mic' is the capture dying under an open microphone (#640). */
	kind: 'trainer' | 'room' | 'voice' | 'mic';
	/** 'silent' and 'no-power' are trainer-only: connected, and delivering
	 * nothing — or frames without watts (#520, #1849). 'offline' is room-only:
	 * the device itself has no network, so the problem is on this end (#2121). */
	state: 'reconnecting' | 'lost' | 'silent' | 'no-power' | 'offline';
}
