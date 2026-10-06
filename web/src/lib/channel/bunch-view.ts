import { coachOf } from '$lib/channel/tick-session';
import type { LiveRider } from '$lib/channel/types';
import type { ServerTick } from '$lib/protocol';

/**
 * The bunch as one tick has it, in the terms the world draws (#3098,
 * ADR-0065). Three-free, so the channel builds it and only the world, loaded
 * lazily, steps it ($lib/world/bunch.ts).
 */
export type BunchView = {
	/** Metres along the road as ridden, a looped road's laps unrolled. */
	m: number;
	mps: number;
	/** When the hub sent it, server ms: a page that handles it late knows by how much. */
	at?: number;
	/** The session's elapsed seconds: what turns the front row. */
	elapsed: number;
	/** The joined riders, in the order they joined. */
	order: string[];
	/** Metres from the bunch, by rider; none while a game hides them. */
	offsets: Record<string, number>;
	resting: string[];
	coach?: string;
	/** Who is connected, and what their legs are doing: a joined rider who is not there is drawn faded. */
	present: Map<string, { watts: number; ftp: number }>;
	/** A game rides: the team car never runs in one (#3098). */
	game: boolean;
	/** Who this tick's cheers are for (#3116): the world draws each over that rider's head. */
	cheered: string[];
};

/** The tick's bunch, or null while the session rides none. A race rides no shared bunch. */
export function bunchOf(
	tick: ServerTick | null,
	riders: LiveRider[],
): BunchView | null {
	const world = tick?.world;
	if (!tick || !world || world.racers) return null;
	const length = tick.state.route?.lengthM ?? 0;
	// The bunch's speed, never the trainer's (ADR-0084: that is the drivetrain's alone).
	const { speedMps: bunchMps } = world;
	return {
		m: world.bunchM + (world.lap ?? 0) * length,
		mps: bunchMps,
		at: tick.at,
		elapsed: tick.state.elapsed,
		order: world.order ?? [],
		offsets: Object.fromEntries(
			Object.entries(world.offsets ?? {}).map(([id, dm]) => [id, dm / 10]),
		),
		resting: world.resting ?? [],
		coach: coachOf(tick.state),
		// Held watts, so a 1 Hz trainer that misses a tick does not stop the legs.
		present: new Map(riders.map((r) => [r.id, { watts: r.watts, ftp: r.ftp }])),
		game: !!tick.game,
		cheered: (tick.cheers ?? []).flatMap((c) => (c.to ? [c.to] : [])),
	};
}
