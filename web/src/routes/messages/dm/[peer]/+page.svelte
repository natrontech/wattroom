<script lang="ts">
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
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { createDmThread } from '$lib/dm/thread.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import MessageThread from '$lib/messages/MessageThread.svelte';
	import type { ThreadSource } from '$lib/messages/thread-types';
	import { presence } from '$lib/presence.svelte';
	import { ChevronLeft, Radio } from '@lucide/svelte';

	const peerId = $derived(page.params.peer ?? '');
	const head = $derived(dmHeads.heads.find((h) => h.peerId === peerId));
	const peerName = $derived(head?.peerName ?? dm.open?.name ?? 'them');
	// Where they are, if anywhere — the one thing the old drawer could never say.
	const inRoom = $derived(
		presence.rooms.find((room) => room.riders?.includes(peerName)),
	);
	const riding = $derived(!!inRoom?.riding?.includes(peerName));

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
		// "nothing" because opening it just stamped now as seen.
		dm.show(id, peerName);
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
		// No reaction backend for DMs yet (#672 follow-up) — omitting
		// `reactions`/`react` hides the affordance rather than failing on
		// click (ux.md).
		retry: () => thread?.retry(),
		send: async (text, image) => (await thread?.send(text, image)) ?? null,
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
	<span class="relative shrink-0">
		<Avatar
			name={peerName}
			avatarUrl={head?.peerAvatarUrl}
			preset={head?.peerAvatarPreset}
			xp={head?.peerTotalXp}
			size={28}
		/>
		{#if riding}
			<span
				class="bg-surface ring-surface absolute -right-1 -bottom-1 rounded-full px-0.5 py-px ring-2"
			>
				<RidingBars size={8} />
			</span>
		{:else if inRoom}
			<span
				class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2"
			></span>
		{/if}
	</span>
	<span class="min-w-0">
		<a
			href="/u/{peerId}"
			class="block truncate text-sm font-medium hover:underline"
			title="{peerName}'s page">{peerName}</a
		>
		<span class="text-muted block truncate text-[11px]">
			{#if riding}riding in {inRoom?.name}{:else if inRoom}in {inRoom.name}{:else}not
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
			<Avatar name={peerName} size={48} />
			<p class="font-display mt-2 text-base font-bold">{peerName}</p>
			<p class="text-muted mt-0.5 text-xs">
				Just you two — messages stay between friends, last 500 kept.
			</p>
		</div>
	{/snippet}
</MessageThread>
