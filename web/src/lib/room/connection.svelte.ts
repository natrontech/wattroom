import { account } from '$lib/account.svelte';
import { notify } from '$lib/notify.svelte';
import { createRoomAv } from '$lib/room/av.svelte';
import { createRoomLive } from '$lib/room/live.svelte';
import { play, setDucked } from '$lib/sound/cues';

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
	// The chat backlog (#201): loaded once per join — the log follows the
	// connection, not the page, like everything else here.
	void fetch(`/api/rooms/${slug}/chat`)
		.then((res) => (res.ok ? res.json() : null))
		.then((body) => {
			if (body?.messages) live.seedChat(body.messages);
		})
		.catch(() => {
			/* backlog is a nicety — live chat still works without it */
		});
	// Presence announces itself (#148) from HERE, not the page — someone
	// arriving is audible even while you are off browsing workouts; hidden
	// tabs get the browser notification instead (#202).
	let known: Set<string> | null = null;
	let seenChat = 0;
	let lastPhase: string | null = null;
	const dispose = $effect.root(() => {
		$effect(() => {
			const roster = live.tick?.roster ?? [];
			const ids = new Set(roster.map((rider) => rider.id));
			if (live.status !== 'live') return;
			if (known === null) {
				known = ids;
				return;
			}
			const before = known;
			known = ids;
			const arrived = roster.filter((rider) => !before.has(rider.id));
			if (arrived.length > 0) {
				play('join');
				notify.push(
					slug,
					`${arrived.map((rider) => rider.name).join(', ')} joined the room`,
					`join-${slug}`,
				);
			} else if ([...before].some((id) => !ids.has(id))) {
				play('leave');
			}
		});

		// Chat lands audibly (#202) — a soft blip, never for your own lines.
		// The backlog seed replaces the log wholesale; the timestamp guard
		// keeps history from replaying as a drumroll.
		$effect(() => {
			const log = live.chatLog;
			if (log.length < seenChat) {
				// The backlog seed replaced the log — resync, no replay.
				seenChat = log.length;
				return;
			}
			const fresh = log.slice(seenChat);
			seenChat = log.length;
			const me = account.me?.displayName;
			for (const line of fresh) {
				if (line.from === me || Date.now() - line.at > 10_000) continue;
				play('chat');
				notify.push(`${line.from} · ${slug}`, line.text, `chat-${slug}`);
			}
		});

		// Room audio follows the connection, not the page (#216): the gate
		// threshold doubles while the jukebox plays, and cues duck under a
		// voice — wherever in the app you are standing.
		$effect(() => {
			av.setMusicPlaying(!!live.tick?.jukebox?.playing);
		});
		$effect(() => {
			setDucked(
				Object.entries(av.speaking).some(
					([id, active]) => active && id !== account.me?.id,
				),
			);
		});

		// A session starting is the one event nobody wants to miss (#202).
		$effect(() => {
			const phase = live.tick?.state.phase ?? null;
			const before = lastPhase;
			lastPhase = phase;
			if (
				before !== null &&
				before !== phase &&
				(phase === 'countdown' || phase === 'running') &&
				before !== 'countdown' &&
				before !== 'paused'
			) {
				notify.push(
					slug,
					'The session is starting — saddle up',
					`session-${slug}`,
				);
			}
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
