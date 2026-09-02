<script lang="ts">
	// The list: rooms and DMs together, unread on top, one line each (#468).
	// A room is a thread here like any other — what was said last, by whom,
	// and the room's own signal under it: who is in, who is in voice, whether
	// anyone is riding.
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { formatThreadWhen, orderThreads } from '$lib/messages/threads';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { presence } from '$lib/presence.svelte';
	import { Headphones, Search, Users } from '@lucide/svelte';

	let { active = '' }: { active?: string } = $props();

	let query = $state('');
	const threads = $derived(
		orderThreads(presence.rooms, dmHeads.heads, (id) => dmHeads.unread(id)),
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
<ul class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
	{#if !presence.loaded}
		<li class="space-y-1 px-2"><Skeleton rows={4} class="h-12" /></li>
	{:else if threads.length === 0}
		<li class="px-1 pt-2">
			<EmptyState>
				Every room's chat and every note between friends lands here — and a
				room's chat reads and writes without joining it.
				{#snippet cta()}
					<a href="/home#rooms" class="btn btn-primary btn-xs">Open a room</a>
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
			<li>
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
							preset={t.head.peerAvatarPreset}
							xp={t.head.peerTotalXp}
							size={32}
						/>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="flex items-baseline gap-2">
							<span class="truncate text-sm {t.unread ? 'font-semibold' : ''}"
								>{t.name}</span
							>
							<span class="text-muted/60 ml-auto shrink-0 font-mono text-[10px]"
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
								class="text-muted/70 mt-0.5 flex items-center gap-1.5 text-[10px]"
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
