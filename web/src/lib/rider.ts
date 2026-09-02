/**
 * A rider's page (ADR-0024): the `/api/riders/{id}` shape and the prose the
 * page makes of it. The numbers here are sums a room already shows —
 * never live watts, heart rate, weight or FTP.
 */
import { api } from '$lib/api';
import { formatDuration } from '$lib/format';

export interface RoomRef {
	slug: string;
	name: string;
}

export interface SharedRide {
	id: string;
	workoutName: string;
	startedAt: string;
	seconds: number;
	kj: number;
	execution: number;
	/** docs/SPEC.md medal kinds won on this ride. */
	medals?: string[];
	inRoom: boolean;
	/** Named only when you are a member of that room. */
	roomName?: string;
}

export interface Rider {
	id: string;
	displayName: string;
	avatarUrl?: string;
	avatarPreset?: string;
	since: string;
	totalXp: number;
	totalKj: number;
	rides: number;
	/** kind → count, scoped to rooms in common. */
	medals: Record<string, number>;
	roomsInCommon: RoomRef[];
	presence: {
		online: boolean;
		inRoom: boolean;
		riding: boolean;
		room?: RoomRef;
	};
	friend: 'self' | 'none' | 'pending_in' | 'pending_out' | 'accepted';
	canAdd: boolean;
	/** Friends and yourself only; null otherwise. */
	month: { rides: number; seconds: number; kj: number } | null;
	sharedRides: SharedRide[] | null;
}

export function fetchRider(id: string) {
	return api<Rider>(`/api/riders/${id}`);
}

/** "48 min · 612 kJ · 96% on target" — one line per shared ride. */
export function rideLine(
	ride: Pick<SharedRide, 'seconds' | 'kj' | 'execution'>,
): string {
	return `${formatDuration(ride.seconds)} · ${ride.kj.toLocaleString()} kJ · ${Math.round(ride.execution * 100)}% on target`;
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
	return ride.inRoom ? 'in a room' : 'solo';
}

export function medalTotal(medals: Record<string, number>): number {
	return Object.values(medals).reduce((sum, n) => sum + n, 0);
}
