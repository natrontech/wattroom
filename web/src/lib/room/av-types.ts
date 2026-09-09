import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';

/**
 * The room's call (#21): LiveKit voice + camera + screenshare, joined with a
 * token the server mints against the same membership check as the metrics
 * socket. AV is transit-only and never recorded (locked privacy decision) —
 * nothing here persists anything.
 *
 * Mic starts on with browser echoCancellation + autoGainControl and no noise
 * suppression (SPEC room audio defaults, ADR-0043); camera starts off. Track ownership: LiveKit owns the media
 * elements' streams, this store owns attachment points keyed by rider id so
 * the dashboard can put faces on the tiles it already has.
 *
 * The types live beside the store rather than inside it (#892), so the seams
 * lifted out of it can name them without importing the store back.
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
