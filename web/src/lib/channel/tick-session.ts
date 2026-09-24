import type { SessionState } from '$lib/protocol';

/** A session is live from its countdown until it closes; `idle` and `done` are not. */
export const isLivePhase = (phase: string | null | undefined): boolean =>
	phase === 'countdown' || phase === 'running' || phase === 'paused';

/**
 * The live session's id (#2450). The tick keeps a finished session's id
 * until the next pick replaces it, so an id alone does not say one runs —
 * following it led to "This session has ended".
 */
export const liveSessionId = (
	state: Pick<SessionState, 'phase' | 'id'> | undefined,
): string | undefined =>
	state && isLivePhase(state.phase) ? state.id || undefined : undefined;

/**
 * Whether a session holds the channel: picked or live, not yet done — the
 * hub's `session.open()`, said again here. Wider than `isLivePhase`, since
 * an idle pick is its coach's too.
 */
export const sessionOpen = (
	state: Pick<SessionState, 'phase' | 'id'> | undefined,
): boolean => !!state?.id && state.phase !== 'done';

/**
 * The coach, while their session is open (#2596). The tick keeps a done
 * session's coach until the next pick, and reading it raw left only them
 * offered Start — the hub would have taken anyone's.
 */
export const coachOf = (
	state: Pick<SessionState, 'phase' | 'id' | 'coach'> | undefined,
): string | undefined => (sessionOpen(state) ? state?.coach : undefined);
