import type { GearState, PauseState, ViewState } from '#lib/protocol.ts';

/**
 * The phone remote's way to the riding screen (#3217, #4425): a voice
 * channel's socket for a ride there (live.svelte.ts), or the rider's own lane
 * for a ride alone (rider-lane.svelte.ts). Presses go out; the riding
 * screen's answers come back.
 */
export type RemoteLink = {
	sendRemote(action: string): void;
	readonly gear: GearState | null;
	readonly pause: PauseState | null;
	readonly view: ViewState | null;
	readonly remoteRefusal: string | null;
};
