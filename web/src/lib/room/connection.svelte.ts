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
	// Blip only for lines newer than the connection itself — the backlog can
	// never replay, and the log's length cap can never freeze the notifier
	// the way index-tracking did (audit #219).
	let lastChatAt = Date.now();
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
		$effect(() => {
			const fresh = live.chatLog.filter((line) => line.at > lastChatAt);
			if (fresh.length === 0) return;
			lastChatAt = fresh[fresh.length - 1].at;
			const me = account.me?.displayName;
			for (const line of fresh) {
				if (line.from === me) continue;
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
			// Leaving mid-sentence must not park every cue at 35% forever.
			return () => setDucked(false);
		});

		// A reconnect leaves a chat gap the tick stream never backfills —
		// re-fetch the log when the socket comes back; the id-merge in
		// seedChat makes this idempotent (audit #219).
		let wasReconnecting = false;
		$effect(() => {
			const status = live.status;
			if (status === 'reconnecting') wasReconnecting = true;
			else if (status === 'live' && wasReconnecting) {
				wasReconnecting = false;
				void fetch(`/api/rooms/${slug}/chat`)
					.then((res) => (res.ok ? res.json() : null))
					.then((body) => {
						if (body?.messages) live.seedChat(body.messages);
					})
					.catch(() => {});
			}
		});

		// PTT keys work on EVERY page while in voice — and a keyup lost to
		// navigation or focus loss must never leave the mic hot (audit #219).
		$effect(() => {
			if (typeof window === 'undefined') return;
			const key = (event: KeyboardEvent, held: boolean) => {
				if (av.mode !== 'ptt' || event.code !== 'Space') return;
				const target = event.target as HTMLElement;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target.isContentEditable
				)
					return;
				event.preventDefault();
				if (!held || !event.repeat) av.setPtt(held);
			};
			const down = (e: KeyboardEvent) => key(e, true);
			const up = (e: KeyboardEvent) => key(e, false);
			const release = () => av.pttHeld && av.setPtt(false);
			window.addEventListener('keydown', down);
			window.addEventListener('keyup', up);
			window.addEventListener('blur', release);
			document.addEventListener('visibilitychange', release);
			return () => {
				release();
				window.removeEventListener('keydown', down);
				window.removeEventListener('keyup', up);
				window.removeEventListener('blur', release);
				document.removeEventListener('visibilitychange', release);
			};
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
