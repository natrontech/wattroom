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
