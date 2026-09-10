<script lang="ts">
	// A room's chat as a thread (#468) — readable and writable whether or
	// not you are in the room. Inside, it is the room connection's own log,
	// tick-fresh, with the room's events between the lines. Outside, it is
	// the backlog polled like a DM, and a post goes over HTTP; the hub hands
	// it to whoever is in there. Being in the room adds voice, the ride and
	// the jukebox — not the words.
	//
	// The body (timeline, states, composer) is MessageThread.svelte, shared
	// with a DM's (#672); this wrapper supplies what only a room has: events
	// on the timeline, reactions, and queuing a link to the jukebox.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Radio from '@lucide/svelte/icons/radio';
	import Users from '@lucide/svelte/icons/users';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { people, type Face } from '$lib/people.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import { uploadImage } from '$lib/chat/upload';
	import { STOCK_CHEERS } from '$lib/icons';
	import MessageThread from '$lib/messages/MessageThread.svelte';
	import { createOutsideThread } from '$lib/messages/outside.svelte';
	import type { ThreadSource } from '$lib/messages/thread-types';
	import { presence } from '$lib/presence.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import type { RoomEvent } from '$lib/protocol';
	import { roomTimeline } from '$lib/room/timeline';
	import { remindersFor } from '$lib/room/reminders';
	import { serverNow } from '$lib/room/server-clock';

	let {
		slug,
		reminders = [],
		ban,
	}: {
		slug: string;
		/** The owner's ban, from the Chat place (#1765); absent from outside. */
		ban?: (id: string, name: string) => void;
		/**
		 * "This starts in ten minutes" (#359) — derived by the client, because
		 * the hub does not know the schedule. Only the room's own Chat place
		 * can supply them: from /messages there is no RoomShell, and a
		 * reminder for a room you are not standing in is not this thread's
		 * job.
		 */
		reminders?: RoomEvent[];
	} = $props();

	const room = $derived(presence.rooms.find((r) => r.slug === slug));
	const name = $derived(room?.name ?? slug);
	const cheers = $derived(room?.cheers ?? STOCK_CHEERS);
	// Standing in this room, the thread IS the room's chat: same log, same
	// socket, no second copy to keep in step.
	const conn = $derived(
		roomConnection.current?.slug === slug ? roomConnection.current : null,
	);

	let outside = $state<ReturnType<typeof createOutsideThread> | null>(null);
	// The room's members, once per room: read from outside there is no room
	// layout to have fetched them and a chat line carries no face (#807);
	// inside and out they are who `@` completes to (#1766) — an offline
	// member most of all, "@Bob you in tonight?" being the point.
	let memberNames = $state<string[]>([]);
	// And its plans, for the one timeline line no server sends (#359): from
	// outside there is no shell to derive the due line from (#1907), and the
	// rider reading a room from /messages is exactly who it is for.
	let upcoming = $state<
		{ id: string; workoutName: string; startsAt: string }[]
	>([]);
	$effect(() => {
		const room = slug;
		memberNames = [];
		upcoming = [];
		void api<{
			members?: (Face & { displayName?: string })[];
			upcoming?: { id: string; workoutName: string; startsAt: string }[];
		}>(`/api/rooms/${room}`).then((res) => {
			if (!res.ok || room !== slug) return;
			const members = res.data.members ?? [];
			people.learn(members.map((m) => ({ ...m, name: m.displayName })));
			memberNames = members.flatMap((m) =>
				m.displayName ? [m.displayName] : [],
			);
			upcoming = res.data.upcoming ?? [];
		});
	});
	// The local second the outside line comes due on; inside, the tick's
	// clock does this through `reminders`.
	let now = $state(serverNow());
	$effect(() => {
		if (conn) return;
		const id = setInterval(() => (now = serverNow()), 1000);
		return () => clearInterval(id);
	});
	const outsideReminders = $derived(conn ? [] : remindersFor(upcoming, now));
	$effect(() => {
		if (conn) {
			outside = null;
			return;
		}
		const thread = createOutsideThread(slug);
		thread.start();
		outside = thread;
		return () => {
			thread.close();
			outside = null;
		};
	});

	const messages = $derived(
		conn ? conn.live.chatLog : (outside?.messages ?? []),
	);
	// What the room did rides only the tick (ADR-0022): from outside there
	// is nothing to interleave, and nothing missed.
	// A finished session's card is the exception (ADR-0034): durable, so it
	// reads the same from outside the room as inside it.
	const recaps = $derived(conn ? conn.live.recaps : (outside?.recaps ?? []));
	const timeline = $derived(
		roomTimeline(
			messages,
			conn ? [...conn.live.roomEvents, ...reminders] : outsideReminders,
			account.me?.displayName,
			recaps,
		),
	);

	// Queuing a link is a jukebox command, and the jukebox is the socket's:
	// from outside the card stays a card.
	const onQueue = $derived(
		conn
			? (url: string) => void addYouTubeUrl(url, conn.live.jukebox)
			: undefined,
	);

	// Inside the room the backlog has a state too (#1764): a room with 500
	// lines used to show "Nothing said here yet" for the whole round trip,
	// and a failed backlog left that up with no Retry.
	const backlog = $derived(conn ? conn.backlog() : null);
	const source: ThreadSource = $derived({
		timeline,
		loading: conn
			? backlog === 'loading' && timeline.length === 0
			: (outside?.loading ?? true),
		// The "N new" line only makes sense read from outside — standing in
		// the room is reading it, and the sidebar already counts it that way.
		error: conn
			? backlog === 'failed'
				? "The room's chat could not be loaded."
				: null
			: (outside?.error ?? null),
		readAt: conn ? null : (outside?.readAt ?? null),
		reactions: conn ? conn.live.chatReactions : (outside?.reactions ?? {}),
		myReacts: conn ? conn.live.myReacts : (outside?.myReacts ?? {}),
		cheers,
		retry: () => (conn ? conn.reloadBacklog() : outside?.retry()),
		ban: conn ? ban : undefined,
		// One endpoint from both sides of the room: standing inside, the
		// socket has no edit command — the hub relays what the PATCH did, so
		// the log this component is already showing updates itself.
		async edit(id, text) {
			if (conn) {
				const res = await api(`/api/rooms/${slug}/chat/${id}`, {
					method: 'PATCH',
					json: { text },
				});
				return res.ok ? null : res.error.message;
			}
			return (await outside?.edit(id, text)) ?? null;
		},
		async react(id, cheer) {
			if (conn) {
				conn.live.react(id, cheer);
				return null;
			}
			return (await outside?.react(id, cheer)) ?? null;
		},
		async send(text, image) {
			if (conn) {
				let imageId: string | undefined;
				if (image) {
					const up = await uploadImage(`/api/rooms/${slug}/chat/images`, image);
					if (up.ok) imageId = up.data.id;
					else return up.error.message;
				}
				// A reconnect queue that is already full refuses the line (#650);
				// the words come back to the box like any other refusal.
				if (!conn.live.chat(text, imageId))
					return "Still reconnecting — that one didn't go. Try again in a moment.";
				return null;
			}
			return (await outside?.send(text, image)) ?? null;
		},
	});
</script>

<header
	class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
>
	<a
		href="/messages"
		class="text-muted hover:text-ink -ml-2 rounded p-1 md:hidden"
		aria-label="all messages"><ChevronLeft size={18} /></a
	>
	<span class="bg-surface grid h-7 w-7 shrink-0 place-items-center rounded">
		{#if room?.icon}
			<RoomIcon icon={room.icon} size={14} class="text-muted" />
		{:else}
			<Users size={14} class="text-muted" />
		{/if}
	</span>
	<span class="min-w-0">
		<span class="block truncate text-sm font-medium">{name}</span>
		<span class="text-muted flex items-center gap-1.5 truncate text-[11px]">
			{#if room?.riding?.length}<RidingBars size={8} />{/if}
			{room?.connected ?? 0} in the room
			{#if room?.voice?.length}
				· <Headphones size={10} /> {room.voice.length} in voice
			{/if}
			· {conn ? 'you are in this room' : 'you are reading from outside'}
		</span>
	</span>
	{#if conn}
		<a href="/r/{slug}" class="btn btn-secondary btn-xs ml-auto shrink-0"
			>Lounge</a
		>
	{:else}
		<!-- The way in — the one thing this page cannot give you. -->
		<a href="/r/{slug}" class="btn btn-accent btn-xs ml-auto shrink-0"
			><Radio size={13} /> Join the room</a
		>
	{/if}
</header>

<MessageThread
	{source}
	imageSrc={(imageId) => `/api/rooms/${slug}/chat/images/${imageId}`}
	mentionNames={[
		...memberNames,
		...(conn?.live.tick?.roster.map((rider) => rider.name) ?? []),
	]}
	{onQueue}
	composerPlaceholder={conn
		? `Message ${name}…`
		: `Message ${name} — you are not in the room, they still see it`}
	extraSendError={conn?.live.refusal}
	composerHint={conn
		? 'The lounge shows this same chat beside the people, the ride and the jukebox.'
		: 'Reactions and links work from here. Being in the room adds voice, the ride and queuing a link to the jukebox — not the words.'}
>
	{#snippet emptyState()}
		<!-- Below md the nav and people buttons float in this band, 48x48 in
		     each bottom corner (#634) — the empty state was rendering under
		     both. Keep it clear of them; above md there are no floats. -->
		<div class="mb-4 px-16 text-center md:px-0">
			<p class="font-display text-base font-bold">{name}</p>
			<p class="text-muted mt-0.5 text-xs">
				Nothing said here yet. Say something — the room keeps its last 500
				lines, and whoever is in there sees it as you type it.
			</p>
		</div>
	{/snippet}
</MessageThread>
