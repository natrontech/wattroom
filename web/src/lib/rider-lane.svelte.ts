import type {
	GearState,
	LobbyClientMessage,
	LobbyLane,
	PauseState,
	RemoteCommand,
	ViewState,
} from '$lib/protocol';

/**
 * The rider's own lane on the lobby socket (#4425): the phone remote of a ride
 * alone, which has no voice channel socket to travel on (ADR-0093). Every
 * framed screen holds the lobby socket on every page (presence.svelte.ts), so
 * the screen riding alone and the rider's phone meet here. The hub sends a
 * screen's frames to its own rider's other screens only.
 *
 * The shape is a voice channel's remote (live.svelte.ts, #3217): the phone
 * sends presses, the riding screen hears them and answers with its gear,
 * pause and view.
 */
let send: ((msg: LobbyClientMessage) => void) | null = null;
// Not $state: nothing renders it, and the effect that claims must not
// depend on what it writes.
let claim: { riding: boolean; tab: string; device: string } = {
	riding: false,
	tab: '',
	device: '',
};
let elsewhere = $state('');
let gear = $state.raw<GearState | null>(null);
let pause = $state.raw<PauseState | null>(null);
let view = $state.raw<ViewState | null>(null);
let refusal = $state<string | null>(null);
const listeners = new Set<(cmd: RemoteCommand) => void>();

/** Whether a lobby frame is the lane's rather than a presence ping. */
export function isLaneFrame(frame: LobbyLane): boolean {
	return !!(
		frame.ride ||
		frame.remote ||
		frame.gear ||
		frame.pause ||
		frame.view ||
		frame.error
	);
}

function say(msg: LobbyClientMessage) {
	send?.(msg);
}

export const riderLane = {
	/**
	 * The lobby socket opened: say what this screen rides, which also asks
	 * where the rider's ride is. Resent on every open, as a sensor claim is.
	 */
	opened(next: (msg: LobbyClientMessage) => void) {
		send = next;
		say({ ride: claim });
	},
	/** The socket closed: nothing sends until it opens again. */
	closed() {
		send = null;
	},
	/** The socket stopped for good (signed out): forget the ride elsewhere. */
	reset() {
		send = null;
		elsewhere = '';
		gear = pause = view = null;
		refusal = null;
	},
	/** A frame the hub sent on the lane. */
	heard(frame: LobbyLane) {
		if (frame.ride) {
			elsewhere = frame.ride.device;
			if (!elsewhere) gear = pause = view = null;
		}
		if (frame.gear) gear = frame.gear;
		if (frame.pause) pause = frame.pause;
		if (frame.view) view = frame.view;
		refusal = frame.error?.message ?? null;
		if (frame.remote) for (const hear of listeners) hear(frame.remote);
	},

	/** This screen runs the rider's ride alone, or stopped. The whole state. */
	claimRide(riding: boolean, tab: string, device: string) {
		if (claim.riding === riding && claim.tab === tab && claim.device === device)
			return;
		claim = { riding, tab, device };
		say({ ride: claim });
	},
	/** The device word of another screen riding alone, or '' when none does. */
	get elsewhere() {
		return elsewhere;
	},

	// The remote's half, the shape PhoneRemote reads (remote-link.ts).
	sendRemote(action: string) {
		say({ remote: { action } });
	},
	get gear() {
		return gear;
	},
	get pause() {
		return pause;
	},
	get view() {
		return view;
	},
	get remoteRefusal() {
		return refusal;
	},

	// The riding screen's half.
	onRemote(hear: (cmd: RemoteCommand) => void) {
		listeners.add(hear);
		return () => void listeners.delete(hear);
	},
	sendGear(state: GearState) {
		say({ gear: state });
	},
	sendPause(state: PauseState) {
		say({ pause: state });
	},
	sendView(state: ViewState) {
		say({ view: state });
	},
};
