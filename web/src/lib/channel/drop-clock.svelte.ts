import type { LiveStatus } from '$lib/channel/live.svelte';

/**
 * How long the channel socket has been down, in whole seconds (#2855): what
 * the connection banner says is stored, and what a game's disconnect grace
 * counts down from. It ticks once a second while the socket is down — a
 * difference against Date.now() read in the template invalidates nothing,
 * so the banner froze at 0:00 for the whole outage.
 *
 * The drop is stamped when the socket goes down and cleared only once it is
 * live again: a redial passes through 'connecting' mid-outage, and that is
 * the same outage, not a new one.
 */
export function dropClock(status: () => LiveStatus | undefined) {
	let droppedAt = $state<number | null>(null);
	let now = $state(Date.now());
	$effect(() => {
		const s = status();
		if (s === 'live') droppedAt = null;
		else if ((s === 'reconnecting' || s === 'offline') && droppedAt === null)
			droppedAt = Date.now();
	});
	$effect(() => {
		if (droppedAt === null) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	return {
		get seconds() {
			return droppedAt === null
				? 0
				: Math.max(0, Math.round((now - droppedAt) / 1000));
		},
	};
}
