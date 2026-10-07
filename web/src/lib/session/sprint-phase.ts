import type { SprintState } from '$lib/protocol';

/**
 * Where a sprint is at server time `now` (#30): the klaxon's count before
 * the window, the 15 s window itself, then its podium. On the server's
 * clock, as the trainer's ERG→slope flip reads the same window (#1411).
 */
export function sprintPhase(
	sprint: Pick<SprintState, 'startsAtMs' | 'endsAtMs'>,
	now: number,
): 'klaxon' | 'live' | 'podium' {
	return now < sprint.startsAtMs
		? 'klaxon'
		: now < sprint.endsAtMs
			? 'live'
			: 'podium';
}
