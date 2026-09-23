import type { PanelMember, LiveRider } from '$lib/channel/types';

/**
 * The people column's three groups. Mid-ride the useful split is riding /
 * not; in the lounge it is voice / not — and either way the members who are
 * not connected close the list, because a room is the same room when nobody
 * has arrived yet.
 */
export function rosterGroups(
	live: boolean,
	riders: LiveRider[],
	members: PanelMember[],
): { here: LiveRider[]; away: LiveRider[]; offline: PanelMember[] } {
	const here = live
		? riders.filter((r) => r.watts > 0)
		: riders.filter((r) => r.inVoice);
	const connected = new Set(riders.map((r) => r.id));
	return {
		here,
		away: riders.filter((r) => !here.includes(r)),
		offline: members.filter((m) => !connected.has(m.id)),
	};
}
