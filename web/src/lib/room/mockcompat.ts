/**
 * Import surface for the designed components (#39 → real): everything they
 * used from the dev mock, sourced from the real modules. The dev mock keeps
 * its own generator; the components no longer know it exists.
 */
export {
	CEILING,
	fillPct,
	formatClock,
	ZONE_BG,
	ZONE_NAMES,
	ZONE_TEXT,
	zoneOf,
} from '$lib/components/zones';
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
	slug: string;
	live: boolean;
	members: number;
	/** Riders connected right now (server presence). */
	connected?: number;
	/** Their names, for the hover and the rooms page. */
	riders?: string[];
}
