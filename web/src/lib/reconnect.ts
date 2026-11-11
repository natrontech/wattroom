/**
 * How long a dropped WebSocket waits before each redial, the last one
 * repeating (docs/spec/voice.md): the first at once, then about 1, 2 and 5 s.
 * The channel socket and the lobby socket both use it.
 *
 * It was 1 s doubling to a 10 s ceiling, so a socket dropped by a blip that
 * was over in a moment still sat out a second, and one that stayed down a
 * little longer waited up to ten seconds after the network was back. A redial
 * costs one HTTP upgrade against one Go process that holds every rider's
 * state in memory, cheap next to a rider's numbers going blank mid-interval.
 */
export const RECONNECT_MS = [0, 1000, 2000, 5000] as const;

/**
 * The wait before redial `attempt` (0 for the first after a drop), in ms.
 * Every wait after the first is spread a quarter either way (#1741): a server
 * restart drops the whole fleet at once, and identical waits brought it back
 * in lockstep. The first stays at once: the restart's first redials fail
 * fast, and the spread starts with the second.
 */
export function reconnectDelay(
	attempt: number,
	random: () => number = Math.random,
): number {
	const base = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
	return Math.round(base * (0.75 + 0.5 * random()));
}
