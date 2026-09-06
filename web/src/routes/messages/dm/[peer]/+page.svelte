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
	import { presence } from '$lib/presence.svelte';
	import { roomOf, statusOf } from '$lib/status';
	import { ChevronLeft, Radio } from '@lucide/svelte';

	const peerId = $derived(page.params.peer ?? '');
	const head = $derived(dmHeads.heads.find((h) => h.peerId === peerId));
	const peerName = $derived(head?.peerName ?? dm.open?.name ?? 'them');
	// Where they are, if anywhere — the one thing the old drawer could never say.
	const inRoom = $derived(roomOf(presence.rooms, peerId));
	const status = $derived(statusOf(presence.rooms, peerId));

	let thread = $state<ReturnType<typeof createDmThread> | null>(null);
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
	});
</script>

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
		preset={head?.peerAvatarPreset}
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
>
	{#snippet emptyState()}
		<div class="mb-4 text-center">
			<Avatar
				name={peerName}
				avatarUrl={head?.peerAvatarUrl}
				preset={head?.peerAvatarPreset}
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
