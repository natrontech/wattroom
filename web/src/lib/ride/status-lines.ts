import { DEFAULTS } from '$lib/workout/guards';

/**
 * Slot 1's persistent lines over the world (#3212, TARGETS G3): one line per
 * state, with the one button that mends it. Ride-critical, so status and
 * never a toast (errors.md). The trainer faults keep their words in
 * channel/fault-copy.ts; this is the rest of the ride's own states.
 */
export interface StatusLine {
	text: string;
	/** The one button that mends it; absent where the state mends itself. */
	action?: string;
	/** Needs the rider now (alert) rather than waiting politely (status). */
	alert?: boolean;
}

export type StatusState =
	| 'trainer-quiet'
	| 'guard-released'
	| 'socket-down'
	| 'voice-down'
	| 'road-removed'
	| 'map-not-yours'
	| 'server-restarted';

const LINES: Record<StatusState, StatusLine> = {
	'trainer-quiet': {
		text: 'Your trainer went quiet.',
		action: 'Reconnect trainer',
		alert: true,
	},
	'guard-released': {
		text: `Trainer released for ${DEFAULTS.spiralReleaseSeconds} s, spin up.`,
	},
	'socket-down': { text: 'Reconnecting, your ride is still recording.' },
	'voice-down': { text: 'Voice reconnecting' },
	'road-removed': {
		text: 'This road was removed by its owner, riding on without it.',
	},
	'map-not-yours': {
		text: "You ride this road's heights; its map is its owner's.",
	},
	'server-restarted': {
		text: 'The server restarted, your ride came back from this browser.',
	},
};

export function statusLine(state: StatusState): StatusLine {
	return LINES[state];
}

/** Build slow: the Skyline shows at once, with how far the road is. */
export function buildingLine(percent: number): StatusLine {
	const shown = Math.round(Math.min(100, Math.max(0, percent)));
	return { text: `Building the road... ${shown} %` };
}
