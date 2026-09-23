<script lang="ts">
	// The list: every direct message, unread on top, one line each (#468) —
	// what was said last, and by whom. A crew's chat is its text channels, in
	// the crew's column (ADR-0058).
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { goto } from '$app/navigation';
	import { personMenu } from '$lib/person-menu';
	import { formatThreadWhen, orderThreads } from '$lib/messages/threads';
	import { UNREAD_DOT } from '$lib/messages/unread-marks';
	import { friends } from '$lib/friends/friends.svelte';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import Search from '@lucide/svelte/icons/search';

	let { active = '' }: { active?: string } = $props();

	let query = $state('');
	const threads = $derived(
		orderThreads(dmHeads.heads, (id) => dmHeads.unread(id)),
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
				Direct messages with your friends land here — a crew talks in its text
				channels.
				{#snippet cta()}
					<a href="/friends" class="btn btn-primary btn-xs">Message a friend</a>
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
			<!-- The same menu the sidebar's rows carry (#2171): below md this
			     list stands in for the sidebar, and the rows had arrived
			     without it. DMs are friends-only (ADR-0012), so a head here is
			     a friend or an ex-friend (#1814); the list this row already
			     reads for its presence dot says which, and "Add friend" is
			     left out when the server would refuse it (#2169). -->
			<li
				title={MENU_HINT}
				{@attach contextMenu(() =>
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
					<Avatar
						name={t.name}
						avatarUrl={t.head.peerAvatarUrl}
						xp={t.head.peerTotalXp}
						status={statusOf(presence.rooms, t.head.peerId, friends.list)}
						size={32}
					/>
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
							{#if t.unread}
								<!-- A DM knows only that something is new, not how much. -->
								<span class={UNREAD_DOT} title="new since you last read it"
								></span>
							{/if}
						</span>
					</span>
				</a>
			</li>
		{/each}
	{/if}
</ul>
