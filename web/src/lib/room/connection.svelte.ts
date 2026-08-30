import { createRoomAv } from '$lib/room/av.svelte';
import { createRoomLive } from '$lib/room/live.svelte';
import { play } from '$lib/sound/cues';

/**
 * The room you are IN (#173, ADR-0010's logical end): joining is a STATE,
 * not a page. The WS presence and the voice connection live here, above the
 * router — open /workouts, run a ramp test, ride solo, and you are still in
 * your room, exactly like idling in a Discord server. Leaving is an
 * explicit act, never a navigation side-effect.
 *
 * One room at a time: joining another leaves the first — you cannot stand
 * in two lounges.
 */
type Connection = {
	slug: string;
	live: ReturnType<typeof createRoomLive>;
	av: ReturnType<typeof createRoomAv>;
	dispose: () => void;
};

let current = $state<Connection | null>(null);

function connect(slug: string): Connection {
	const live = createRoomLive(slug);
	const av = createRoomAv(slug);
	// Presence announces itself (#148) from HERE, not the page — someone
	// arriving is audible even while you are off browsing workouts.
	let known: Set<string> | null = null;
	const dispose = $effect.root(() => {
		$effect(() => {
			const ids = new Set((live.tick?.roster ?? []).map((rider) => rider.id));
			if (live.status !== 'live') return;
			if (known === null) {
				known = ids;
				return;
			}
			const before = known;
			known = ids;
			if ([...ids].some((id) => !before.has(id))) play('join');
			else if ([...before].some((id) => !ids.has(id))) play('leave');
		});
	});
	return { slug, live, av, dispose };
}

export const roomConnection = {
	get current() {
		return current;
	},
	/** Idempotent per slug; switching rooms leaves the old one first. */
	join(slug: string) {
		if (current?.slug === slug) return current;
		this.leave();
		current = connect(slug);
		return current;
	},
	/** The explicit act. Closes the socket, hangs up voice. */
	leave() {
		if (!current) return;
		current.dispose();
		current.live.close();
		current.av.leave();
		current = null;
	},
};
