import { sessionOpen } from '#lib/channel/tick-session.ts';
import type { SessionState } from '#lib/protocol.ts';

/**
 * What SessionControls draws on this screen (#2598), from the roles table in
 * docs/SPEC.md:
 *
 * - `coach` — the coach's controls, on a screen that rides. With no session
 *   open that is anyone here, and Start is how one opens.
 * - `end` / `clear` — the crew's owner or an admin, when someone else holds
 *   the session, or when they hold it from a phone: *End anyone's session*
 *   is theirs on every device, and a pick left behind is ended by clearing it.
 * - `held` — anyone else while a pick waits to start: the Start they would
 *   otherwise see is gone, and the line says who holds the channel.
 */
export type ControlsView = 'coach' | 'end' | 'clear' | 'held' | 'none';

export function controlsFor(o: {
	state: Pick<SessionState, 'phase' | 'id' | 'planner'> | undefined;
	/** This rider, to know the plan's planner (#4562). */
	me?: string;
	/** The coach, or anyone while no session is open — ChannelShell's rule. */
	canControl: boolean;
	/** The crew's owner or an admin. */
	canManage: boolean;
	spectator: boolean;
}): ControlsView {
	if (o.canControl && !o.spectator) return 'coach';
	if (!sessionOpen(o.state)) return 'none';
	const pick = o.state?.phase === 'idle';
	if (o.canManage) return pick ? 'clear' : 'end';
	// Whoever planned it may cancel it until it runs (#4562), whoever
	// pressed Start.
	const before = pick || o.state?.phase === 'countdown';
	if (before && o.me && o.state?.planner === o.me) return 'clear';
	return pick ? 'held' : 'none';
}
