<script lang="ts">
	import { untrack } from 'svelte';
	// A conversation, as a place (ADR-0020) — now beside the rooms' threads
	// (#468). The room connection survives navigation (#191), so reading a
	// DM keeps you in the room and in voice.
	//
	// The body (timeline, states, composer, reactions, the "N new" divider)
	// is MessageThread.svelte, shared with a room's thread (#672); this page
	// only supplies what is DM-specific: the peer's header and the poll
	// loop in createDmThread.
	import { page } from '$app/state';
	import Avatar from '$lib/components/Avatar.svelte';
	import { createDmThread } from '$lib/dm/thread.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { STOCK_CHEERS } from '$lib/icons';
	import MessageThread from '$lib/messages/MessageThread.svelte';
	import type { ThreadSource } from '$lib/messages/thread-types';
	import { people } from '$lib/people.svelte';
	import { friends } from '$lib/friends/friends.svelte';
	import { presence } from '$lib/presence.svelte';
	import { fetchRider, type Rider } from '$lib/rider';
	import { roomOf, statusOf } from '$lib/status';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Radio from '@lucide/svelte/icons/radio';

	const peerId = $derived(page.params.peer ?? '');
	const head = $derived(dmHeads.heads.find((h) => h.peerId === peerId));
	// A conversation reached by its link — a notification, a pasted URL, a
	// reload — has no head yet and nobody told dm.show the name, so the page
	// read "them" until the first line. Their page knows who they are.
	let fetchedName = $state<string | null>(null);
	// Messages are for accepted friends (dms.go). The friends list every
	// page holds is the first word on where it stands (#1814: the head used
	// to short-circuit the lookup, so an ex-friend's box stayed open and Send
	// answered 403); the rider's page is the cold-load fallback, and a page
	// that will not open (nothing shared) is a stranger. Null while unknown —
	// the box stays open rather than flickering shut.
	let fetched = $state<Rider['friend'] | 'stranger' | null>(null);
	const listed = $derived(
		friends.list?.find((f) => f.id === peerId)?.status ?? null,
	);
	// The list's word, else the page's; null while neither has answered, so
	// the box opens once and never flickers shut — a list that has not seen
	// a friendship made a minute ago is not a reason to disable the input
	// under the focus the composer just took.
	const friendship = $derived<Rider['friend'] | 'stranger' | null>(
		listed ?? fetched,
	);
	// The reason the box is shut, in the words of where the ask stands: a
	// request already sent is not "add them", it is "wait for them".
	const lock = $derived.by(() => {
		// A thread with lines and no friendship is a friendship that ended
		// (ADR-0012: the channel closes with it): what was said stays, the
		// box is shut, and the copy must not read as "you share nothing".
		if (history && (friendship === 'none' || friendship === 'stranger'))
			return `You and ${peerName} are no longer friends — what was said stays, the box is shut.`;
		switch (friendship) {
			case 'pending_out':
				return `You asked ${peerName} to be friends — messages open once they accept.`;
			case 'pending_in':
				return `${peerName} asked to be friends — accept on Friends and the box opens.`;
			case 'none':
				return `Messages are between friends. Add ${peerName} from their page first.`;
			case 'stranger':
				return 'Messages are between friends, and you share nothing with them yet.';
			default:
				return null;
		}
	});
	// dm.show below is called with whatever this page knows, which on a cold
	// load is "them" — so that placeholder is never a known name.
	const knownName = $derived(
		head?.peerName ??
			(dm.open?.name && dm.open.name !== 'them' ? dm.open.name : undefined),
	);
	const peerName = $derived(knownName ?? fetchedName ?? 'them');
	let asked = '';
	$effect(() => {
		const id = peerId;
		if (asked !== id) {
			fetchedName = null;
			fetched = null;
		}
		// Nothing left to learn: the list says friend and the head says name.
		if (!id || (knownName && listed === 'accepted')) return;
		if (asked === id) return;
		asked = id;
		void fetchRider(id).then((res) => {
			if (!res.ok) {
				if (res.error.error === 'not_found') fetched = 'stranger';
				return;
			}
			if (res.data.id !== id) return;
			fetched = res.data.friend;
			fetchedName = res.data.displayName;
			people.learn([
				{
					id,
					name: res.data.displayName,
					avatarUrl: res.data.avatarUrl,
				},
			]);
		});
	});
	// Where they are, if anywhere — the one thing the old drawer could never say.
	const inRoom = $derived(roomOf(presence.rooms, peerId));
	const status = $derived(statusOf(presence.rooms, peerId, friends.list));

	let thread = $state<ReturnType<typeof createDmThread> | null>(null);
	// Lines on screen: what tells an ended friendship from a stranger's.
	const history = $derived((thread?.timeline.length ?? 0) > 0);
	$effect(() => {
		const id = peerId;
		if (!id) {
			thread = null;
			return;
		}
		const t = createDmThread(id, () => peerName);
		t.start();
		thread = t;
		// The open thread, so a new line in it blips nowhere (heads.svelte).
		// Stamped AFTER the thread captures its readAt, so the "N new" line
		// marks what's new since the last time this thread was open, not
		// "nothing" because opening it just stamped now as seen. The name is
		// read untracked: it arrives with the heads poll, and tracking it
		// tore the thread down and rebuilt it — readAt and the divider with
		// it (#824). The thread reads it live through the getter above.
		dm.show(
			id,
			untrack(() => peerName),
		);
		dmHeads.bump();
		return () => {
			t.close();
			dm.close();
			thread = null;
		};
	});

	const source: ThreadSource = $derived({
		timeline: thread?.timeline ?? [],
		loading: thread?.loading ?? true,
		error: thread?.error ?? null,
		readAt: thread?.readAt ?? null,
		// A DM has no room icon to draw a custom cheer palette from, so it
		// speaks the same stock vocabulary a room falls back to (#777).
		reactions: thread?.reactions ?? {},
		myReacts: thread?.myReacts ?? {},
		cheers: STOCK_CHEERS,
		retry: () => thread?.retry(),
		send: async (text, image) => (await thread?.send(text, image)) ?? null,
		react: async (id, cheer) => (await thread?.react(id, cheer)) ?? null,
		edit: async (id, text) => (await thread?.edit(id, text)) ?? null,
	});
</script>

<svelte:head><title>{peerName} · WattRoom</title></svelte:head>

<!-- The header: who they are, whether they are around, and the one thing
     you want from a friend who is riding — the way in. -->
<header
	class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
>
	<a
		href="/messages"
		class="text-muted hover:text-ink -ml-2 rounded p-1 md:hidden"
		aria-label="all messages"><ChevronLeft size={18} /></a
	>
	<Avatar
		name={peerName}
		avatarUrl={head?.peerAvatarUrl}
		xp={head?.peerTotalXp}
		{status}
		size={28}
	/>
	<span class="min-w-0">
		<a
			href="/u/{peerId}"
			class="block truncate text-sm font-medium hover:underline"
			title="{peerName}'s page">{peerName}</a
		>
		<span class="text-muted block truncate text-[11px]">
			{#if status === 'riding'}riding in {inRoom?.name}{:else if inRoom}in {inRoom.name}{:else}not
				in a room{/if}
		</span>
	</span>
	{#if inRoom}
		<a href="/r/{inRoom.slug}" class="btn btn-accent btn-xs ml-auto shrink-0"
			><Radio size={13} /> Join them</a
		>
	{/if}
</header>

<MessageThread
	{source}
	imageSrc={(imageId) => `/api/dms/images/${imageId}`}
	composerPlaceholder="Message {peerName}…"
	composerLock={lock}
	editHint="Escape cancels · they see the change"
	lineGapMs={0}
>
	{#snippet emptyState()}
		<div class="mb-4 text-center">
			<Avatar
				name={peerName}
				avatarUrl={head?.peerAvatarUrl}
				xp={head?.peerTotalXp}
				size={48}
			/>
			<p class="font-display mt-2 text-base font-bold">{peerName}</p>
			<p class="text-muted mt-0.5 text-xs">
				Just you two — messages stay between friends, last 500 kept.
			</p>
		</div>
	{/snippet}
</MessageThread>
