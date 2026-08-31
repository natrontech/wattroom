/**
 * How the docked player converges on the room's shared playhead (#23).
 *
 * Tiered: a big gap seeks, a small one nudges the playback rate, anything
 * inside the deadband plays straight. A livestream is the exception — it has
 * no shared timeline, so the room's anchor walks off into the DVR window and
 * a chasing client seeks on every single tick. Live rides the edge instead.
 */
export type Chase = { do: 'seek'; to: number } | { do: 'rate'; rate: number };

export function chase(targetSec: number, atSec: number, live: boolean): Chase {
	if (live) return { do: 'rate', rate: 1 };
	const drift = targetSec - atSec;
	if (Math.abs(drift) > 2) return { do: 'seek', to: targetSec };
	if (Math.abs(drift) > 0.3)
		return { do: 'rate', rate: drift > 0 ? 1.25 : 0.75 };
	return { do: 'rate', rate: 1 };
}
