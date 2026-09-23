import type { LiveChannel, LiveCrew, LiveOccupant } from '$lib/crews-live';

/** A voice channel with somebody in it besides you, and the crew it is in. */
export interface AroundChannel {
	crew: LiveCrew;
	channel: LiveChannel;
	/** Who is there besides you, in the hub's order. */
	others: LiveOccupant[];
}

/**
 * Home's "Around right now": the voice channels in your crews with somebody
 * ELSE in them (#1502). The crews' live read lists you in the channel you
 * stand in like anyone, so a channel you stood in alone read as busy, with a
 * "Walk in" pointed at you. The read holds only channels you may enter
 * (#2444), so everything here is a door that opens.
 */
export function aroundNow(
	crews: readonly LiveCrew[],
	meId: string,
): AroundChannel[] {
	return crews.flatMap((crew) =>
		crew.channels
			.filter((channel) => channel.kind === 'voice')
			.map((channel) => ({
				crew,
				channel,
				others: (channel.occupants ?? []).filter((o) => o.id !== meId),
			}))
			.filter((around) => around.others.length > 0),
	);
}
