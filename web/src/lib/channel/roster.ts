import type { PanelMember, LiveRider } from '$lib/channel/types';
import type { LiveCrew } from '$lib/crews-live';
import { statusOfRider, type PresenceStatus } from '$lib/status';

/** Where a member is instead of here: the voice channel, and how they are. */
export interface Elsewhere {
	channel: string;
	status: PresenceStatus;
}

/**
 * The crew's members standing in its OTHER voice channels (#2536), by id,
 * from the crew's live read the sidebar draws its rows from. A crew with two
 * voice channels puts half its people in the other one (ADR-0058): online,
 * just not here.
 */
export function elsewhereIn(
	crew: LiveCrew | undefined,
	here: string,
): Map<string, Elsewhere> {
	const out = new Map<string, Elsewhere>();
	for (const channel of crew?.channels ?? []) {
		if (channel.id === here) continue;
		for (const occupant of channel.occupants ?? [])
			if (!out.has(occupant.id))
				out.set(occupant.id, {
					channel: channel.name,
					status: statusOfRider(occupant),
				});
	}
	return out;
}

/**
 * The people column's groups. Mid-ride the useful split is riding / not; in
 * the lounge it is voice / not — then the members in another of the crew's
 * channels, and last the rest, because a channel is the same channel when
 * nobody has arrived yet.
 *
 * The rest are members this channel has not got, which is all it knows
 * (#2849): a friend on Home has the app open, and online is ADR-0012's to
 * say, to accepted friends only. And never you — with your own socket
 * refused there is no tick to find you in, and you are not offline to
 * yourself.
 */
export function rosterGroups(
	live: boolean,
	riders: LiveRider[],
	members: PanelMember[],
	elsewhere: ReadonlyMap<string, Elsewhere> = new Map(),
	me?: string,
): {
	here: LiveRider[];
	away: LiveRider[];
	elsewhere: (PanelMember & Elsewhere)[];
	notHere: PanelMember[];
} {
	// A dropped trainer holds its last watts a few seconds (#2851); that
	// rider is not holding target, whatever the number says.
	const here = live
		? riders.filter((r) => r.watts > 0 && !r.stale)
		: riders.filter((r) => r.inVoice);
	const connected = new Set(riders.map((r) => r.id));
	const absent = members.filter((m) => !connected.has(m.id) && m.id !== me);
	return {
		here,
		away: riders.filter((r) => !here.includes(r)),
		elsewhere: absent.flatMap((m) => {
			const where = elsewhere.get(m.id);
			return where ? [{ ...m, ...where }] : [];
		}),
		notHere: absent.filter((m) => !elsewhere.has(m.id)),
	};
}
