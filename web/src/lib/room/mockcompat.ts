/**
 * Import surface for the designed components (#39 → real): everything they
 * used from the dev mock, sourced from the real modules. The dev mock keeps
 * its own generator; the components no longer know it exists.
 */
export {
	CEILING,
	fillPct,
	ZONE_BG,
	ZONE_NAMES,
	ZONE_TEXT,
	zoneOf,
} from '$lib/components/zones';
export { formatClock } from '$lib/format';
export {
	bandWatts,
	describeBlock,
	targetState,
	TILE_METRICS,
	type Block,
	type RoomRider,
	type RoomRider as MockRider,
	type TileMetric,
} from '$lib/room/view';

/** Presence phases as the designed components speak them. */
export type Phase = 'lounge' | 'countdown' | 'live';

export interface Fault {
	kind: 'trainer' | 'room';
	state: 'reconnecting' | 'lost';
}

/** RoomRail's room list entry. */
export interface RailRoom {
	name: string;
	/** Owner-set emoji identity mark (#223); '' = none. */
	icon?: string;
	slug: string;
	live: boolean;
	members: number;
	/** Riders connected right now (server presence). */
	connected?: number;
	/** Their names, for the hover and the rooms page. */
	riders?: string[];
	/** Who is in the voice channel (#149) — the radar's core signal. */
	voice?: string[];
	/** The next planned session, when one exists. */
	next?: { workoutName: string; startsAt: string };
}
