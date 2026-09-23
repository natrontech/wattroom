<script lang="ts">
	// The list: rooms and DMs together, unread on top, one line each (#468).
	// A room is a thread here like any other — what was said last, by whom,
	// and the room's own signal under it: who is in, who is in voice, whether
	// anyone is riding.
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { goto } from '$app/navigation';
	import { roomMenu } from '$lib/nav/room-menu';
	import { personMenu } from '$lib/person-menu';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { leaveRoom } from '$lib/room/leave';
	import { formatThreadWhen, orderThreads } from '$lib/messages/threads';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { friends } from '$lib/friends/friends.svelte';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';

	let { active = '' }: { active?: string } = $props();

	let query = $state('');
	const threads = $derived(
		// A crew room you may not enter is a row that would fail on click
		// (#1741); the rail feed carries it for the crew, not for this list.
		orderThreads(
			presence.rooms.filter((r) => !!r.role),
			dmHeads.heads,
			(id) => dmHeads.unread(id),
		),
	);
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return threads;
		return threads.filter(
			(t) =>
				t.name.toLowerCase().includes(q) || t.preview.toLowerCase().includes(q),
		);
	});
</script>

<div class="px-3 pt-3 pb-2">
	<label class="input input-xs flex items-center gap-2">
		<Search size={12} class="text-muted shrink-0" />
		<input
			bind:value={query}
			class="min-w-0 flex-1 bg-transparent outline-none"
			placeholder="Search messages"
			aria-label="search messages"
		/>
	</label>
</div>
<ul data-testid="thread-list" class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
	{#if !presence.loaded || !dmHeads.loaded}
		<li class="space-y-1 px-2"><Skeleton rows={4} class="h-12" /></li>
	{:else if dmHeads.error}
		<!-- The fourth state (errors.md, #1816): a refused poll used to read as
		     "no conversations". -->
		<li class="px-1 pt-2">
			<Banner tone="error">
				{dmHeads.error}
				{#snippet action()}
					<button onclick={() => dmHeads.retry()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</li>
	{:else if threads.length === 0}
		<li class="px-1 pt-2">
			<EmptyState>
				Every room's chat and every note between friends lands here — and a
				room's chat reads and writes without joining it.
				{#snippet cta()}
					<a href="/friends" class="btn btn-primary btn-xs">Message a friend</a>
					<a href="/home#rooms" class="btn btn-secondary btn-xs">Open a room</a>
				{/snippet}
			</EmptyState>
		</li>
	{:else if shown.length === 0}
		<li class="text-muted px-2 py-4 text-center text-xs">
			Nothing here matches “{query.trim()}”.
		</li>
	{:else}
		{#each shown as t (t.key)}
			{@const on = active === t.href}
			<!-- The same menus the sidebar's rows carry (#2171): below md this
			     list stands in for the sidebar, and the rows had arrived
			     without them. Nothing new is offered here — the builders are
			     the sidebar's own. -->
			<li
				title={MENU_HINT}
				{@attach contextMenu(() =>
					t.kind === 'room'
						? roomMenu(t.room, {
								here: roomConnection.current?.slug === t.room.slug,
								onLeave: leaveRoom,
							})
						: // DMs are friends-only (ADR-0012), so a head here is a friend
							// or an ex-friend (#1814); the list this row already reads for
							// its presence dot says which, and "Add friend" is left out
							// when the server would refuse it (#2169).
							personMenu(t.head.peerId, goto, {
								conversation: true,
								friendship: friends.list?.find((f) => f.id === t.head.peerId)
									?.status,
							}),
				)}
			>
				<a
					href={t.href}
					aria-current={on ? 'page' : undefined}
					class="flex items-center gap-2.5 rounded px-2 py-2 {on
						? 'bg-surface-raised'
						: 'hover:bg-surface-raised/60'}"
				>
					{#if t.kind === 'room'}
						<span
							class="bg-surface grid h-8 w-8 shrink-0 place-items-center rounded"
						>
							{#if t.icon}
								<RoomIcon icon={t.icon} size={14} class="text-muted" />
							{:else}
								<Users size={14} class="text-muted" />
							{/if}
						</span>
					{:else}
						<Avatar
							name={t.name}
							avatarUrl={t.head.peerAvatarUrl}
							xp={t.head.peerTotalXp}
							status={statusOf(crewLive.crews, t.head.peerId, friends.list)}
							size={32}
						/>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="flex items-baseline gap-2">
							<span class="truncate text-sm {t.unread ? 'font-semibold' : ''}"
								>{t.name}</span
							>
							<span class="text-muted-dim num ml-auto shrink-0 text-[10px]"
								>{formatThreadWhen(t.at)}</span
							>
						</span>
						<span class="flex items-center gap-1.5">
							<span
								class="min-w-0 flex-1 truncate text-xs {t.unread
									? 'text-ink/80'
									: 'text-muted'}">{t.preview}</span
							>
							{#if t.kind === 'room' && t.unread}
								<span
									class={UNREAD_COUNT}
									title="{t.unread} new since you were last here"
									>{unreadCount(t.unread)}</span
								>
							{:else if t.unread}
								<!-- A DM knows only that something is new, not how much. -->
								<span class={UNREAD_DOT} title="new since you last read it"
								></span>
							{/if}
						</span>
						{#if t.kind === 'room' && (t.here || t.voice)}
							<span
								class="text-muted-dim mt-0.5 flex items-center gap-1.5 text-[10px]"
							>
								{#if t.riding}<RidingBars size={8} />{/if}
								{t.here} here{#if t.voice}
									· <Headphones size={9} /> {t.voice}{/if}
							</span>
						{/if}
					</span>
				</a>
			</li>
		{/each}
	{/if}
</ul>
