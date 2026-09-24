import type { LiveChannel, LiveOccupant } from '$lib/crews-live';

/**
 * A rider an admin moved (#2730) whose client has not arrived yet (#2745).
 * The sidebar draws them where they are going from the moment of the drop,
 * so the name lands under the pointer instead of a round trip later.
 */
export interface MoveInFlight {
	rider: LiveOccupant;
	from: string;
	to: string;
}

/**
 * How long a moved name waits in its new channel for the rider. A live tab
 * navigates and reconnects in a second or two; past this, their app was
 * asleep or gone, and the name goes back to where the server still has it.
 */
export const ARRIVAL_MS = 10_000;

/** The server's presence has the rider where they were moved. */
export function arrived(
	channels: readonly LiveChannel[],
	move: MoveInFlight,
): boolean {
	return !!channels
		.find((c) => c.id === move.to)
		?.occupants?.some((o) => o.id === move.rider.id);
}

// The hub's order (hub/presence.go sorts by name, bytewise), so a landed name
// sits where it will stay once the rider really arrives.
const byName = (a: LiveOccupant, b: LiveOccupant) =>
	a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Who each voice channel shows, by channel id: the server's presence with
 * every move still in flight drawn at its destination. A rider stands in one
 * channel at a time, so a moving one leaves every other list.
 */
export function occupantsWithMoves(
	channels: readonly LiveChannel[],
	moves: readonly MoveInFlight[],
): Map<string, LiveOccupant[]> {
	const flying = new Map(
		moves.filter((m) => !arrived(channels, m)).map((m) => [m.rider.id, m]),
	);
	const out = new Map<string, LiveOccupant[]>();
	for (const c of channels) {
		const list = (c.occupants ?? []).filter((o) => !flying.has(o.id));
		const landing = [...flying.values()].filter((m) => m.to === c.id);
		if (landing.length) {
			list.push(...landing.map((m) => m.rider));
			list.sort(byName);
		}
		out.set(c.id, list);
	}
	return out;
}
