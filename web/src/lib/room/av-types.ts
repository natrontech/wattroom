import type {
	LocalVideoTrack,
	RemoteTrack,
	Track as LiveKitTrack,
} from 'livekit-client';

/**
 * The names the room's AV seams share (#892).
 *
 * Beside the store rather than inside it, so that every seam lifted out of
 * `av.svelte.ts` can say what it takes and returns without importing the
 * store back. What the call itself is and where each part of it lives is at
 * the head of `av.svelte.ts`.
 */
export type LiveKitClient = typeof import('livekit-client');

export type AvStatus =
	'off' | 'connecting' | 'live' | 'reconnecting' | 'failed';

/**
 * Why the last thing the rider asked of voice did not happen (#642). Not a
 * toast: a rider on a bike reads it a minute later, mid-interval, so the
 * sidebar keeps it until the next attempt clears it. `signIn` marks the one
 * failure whose remedy is a page, not a retry.
 */
export interface AvError {
	message: string;
	signIn: boolean;
}

/** One rider's track, and which connection of theirs published it (#293). */
export type Owned = { owner: string; track: RemoteTrack | LocalVideoTrack };

/**
 * As much of a LiveKit participant as the claim protocol needs (#293). Named
 * here because two seams hand one over — the event surface on
 * ParticipantConnected, the join path walking the roster it arrives to — and
 * neither should have to spell the shape out again.
 */
export interface ClaimantSource {
	identity: string;
	joinedAt?: Date;
	getTrackPublication: (
		source: LiveKitTrack.Source,
	) => { isMuted: boolean } | undefined;
}
