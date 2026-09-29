import { serverNow } from '$lib/server-clock';
import { targetAt } from '$lib/workout/engine';
import { createSprintWindow } from '$lib/workout/sprint-window.svelte';
import type { RideDeps } from '$lib/session/ride-deps';

/**
 * The sprints a session rider can be handed: the one the server armed, live
 * for as long as its window runs, and the workout's own sprint blocks as a
 * window the screen draws.
 *
 * Called during component init, like createRide: the $derived and $effect
 * inside need the component's effect context.
 */
export function createSessionSprint(
	deps: Pick<RideDeps, 'live' | 'profile' | 'shared' | 'segments'>,
) {
	/**
	 * A local re-check while a sprint is on the board (#789). The window is a
	 * deadline, not a state the server keeps repeating: read off the last
	 * tick's `at`, a socket that drops mid-sprint freezes the clock inside the
	 * window and leaves SIM grade — or the single-speed 2xFTP command —
	 * applied for as long as the drop lasts. Nothing else re-evaluates,
	 * because no tick arrives to re-evaluate on.
	 */
	let sprintClock = $state(serverNow());
	$effect(() => {
		if (!deps.live.tick?.sprint) return;
		const id = setInterval(() => (sprintClock = serverNow()), 250);
		return () => clearInterval(id);
	});

	const armedLive = $derived.by(() => {
		const sprint = deps.live.tick?.sprint;
		if (!sprint) return false;
		// serverNow() is the server's clock carried on this machine's, so it
		// keeps moving while the socket is down and stays skew-corrected when
		// it comes back ($lib/server-clock). sprintClock is what makes this
		// recompute without a tick.
		const at = Math.max(sprintClock, serverNow());
		return at >= sprint.startsAtMs && at < sprint.endsAtMs;
	});
	/**
	 * The workout's own sprint blocks (#2014), as a window the session's
	 * SprintMoment and klaxon already know how to draw — the same module the
	 * solo ride runs (#1793). Anchored off the session's elapsed, so every rider
	 * counts the same block in at the same moment.
	 */
	const blockWindow = createSprintWindow(() => {
		const shared = deps.shared();
		const segments = deps.segments();
		const running = !!shared && shared.phase === 'running';
		const info =
			running && segments.length > 0
				? targetAt(segments, deps.profile.current.ftp, shared.elapsed)
				: undefined;
		return {
			segments,
			segment: info?.segment,
			index: info?.segmentIndex ?? 0,
			clock: shared?.elapsed ?? 0,
			done: info?.done ?? true,
			over: !running,
		};
	});
	// Re-anchored on the session's clock rather than a local interval: the window
	// carries a deadline in server-ms, and reading it half a second after the
	// tick that moved `elapsed` would count the block in half a second late.
	$effect(() => {
		void deps.shared()?.elapsed;
		blockWindow.sync();
	});

	return {
		/** The server's armed sprint is inside its window, by this machine's clock. */
		get armedLive() {
			return armedLive;
		},
		/** The workout's own sprint block as a window, or null. */
		get blockWindow() {
			return blockWindow.current;
		},
	};
}
