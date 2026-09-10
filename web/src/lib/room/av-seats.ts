import type { Owned } from '$lib/room/av-types';

/**
 * Who is in which seat, and which of their connections put them there
 * (#293, #1124). Lifted out of `av.svelte.ts` with the LiveKit event surface
 * (#1698): the events are where seats are claimed and given up, and the
 * ownership rule below is the only reason those handlers are safe.
 *
 * Pictures are keyed by RIDER — the tiles and the stage are — but tagged with
 * the connection that published them: when a rider's older tab drops its
 * camera, it must not delete the track their newer tab just put up. Every
 * mutation therefore asks who owns the seat first.
 *
 * Audio is keyed by CONNECTION instead, one element and one gain each, and a
 * rider can publish two audio tracks from one identity — their voice and
 * their machine. Keyed by identity alone the second arrival replaced the
 * first, so sharing your screen took your voice off everyone's speakers with
 * nothing anywhere saying so (#1124). `audioKey` is that second half of the
 * name; the suffix rather than a separate map, because every caller already
 * has the publication's source in hand.
 *
 * No SDK past this line — which is what lets the ownership rule be tested
 * without a LiveKit mock.
 */

/** The two kinds of picture a rider can put on the stage. */
export type Picture = 'video' | 'screen';

/** A rider's voice and a rider's shared machine, told apart by name. */
export function audioKey(identity: string, share: boolean): string {
	return share ? identity + ' \u2014 share' : identity;
}

export type Seats = ReturnType<typeof createSeats>;

export function createSeats() {
	const pictures: Record<Picture, Map<string, Owned>> = {
		video: new Map(),
		screen: new Map(),
	};
	/** Audio plumbing is per CONNECTION: one element and one gain each. */
	const audio = new Map<string, HTMLAudioElement>();

	return {
		audio,
		get(kind: Picture, rider: string) {
			return pictures[kind].get(rider);
		},
		set(kind: Picture, rider: string, owned: Owned) {
			pictures[kind].set(rider, owned);
		},
		/**
		 * Whose seat this is, without touching it: a camera going quiet keeps
		 * its subscription, so the mute handlers ask who owns the seat and
		 * leave the track where it is for the unmute.
		 */
		owns(kind: Picture, rider: string, owner: string) {
			return pictures[kind].get(rider)?.owner === owner;
		},
		/** Forget a rider's track only if this connection is the one that owns it. */
		drop(kind: Picture, rider: string, owner: string) {
			if (pictures[kind].get(rider)?.owner !== owner) return false;
			pictures[kind].delete(rider);
			return true;
		},
		/** A disconnect empties the room: every seat, and every element with it. */
		clear() {
			for (const el of audio.values()) el.remove();
			audio.clear();
			pictures.video.clear();
			pictures.screen.clear();
		},
	};
}
