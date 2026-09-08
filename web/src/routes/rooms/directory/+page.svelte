<script lang="ts">
	// The opt-in public room directory (#1118, ADR-0039).
	//
	// It shows a room's name, its icon, and the way in. Nothing else — no
	// member count, no activity, no owner. Finding a room is not reading it,
	// and this page is the only surface in WattRoom a rider reaches about
	// rooms they have never been in, so what it discloses is the decision.
	import Compass from '@lucide/svelte/icons/compass';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import { api } from '$lib/api';

	interface Entry {
		slug: string;
		name: string;
		icon?: string;
	}

	let rooms = $state<Entry[] | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		error = null;
		const res = await api<{ rooms: Entry[] }>('/api/rooms/directory');
		if (res.ok) rooms = res.data.rooms;
		else error = res.error.message;
	}

	$effect(() => {
		void load();
	});
</script>

<svelte:head><title>Find a room · WattRoom</title></svelte:head>

<main class="page">
	<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="font-display text-2xl font-bold tracking-tight">Find a room</h1>
		<p class="text-muted text-xs">
			Rooms whose owners chose to be findable; joining one puts you in its crew.
			Everything else takes the crew's invite.
		</p>
	</header>

	{#if error}
		<!-- Never a blank page on failure, and the retry is the affordance
		     (errors.md) rather than a sentence telling somebody to reload. -->
		<div class="mt-6">
			<Banner tone="error">
				{error}
				<button onclick={() => void load()} class="ml-1 underline"
					>Try again</button
				>
			</Banner>
		</div>
	{:else if rooms === null}
		<ul class="mt-6 space-y-2">
			{#each { length: 4 } as _, i (i)}
				<li class="border-muted/15 rounded-lg border p-4"><Skeleton /></li>
			{/each}
		</ul>
	{:else if rooms.length === 0}
		<div class="mt-6">
			<EmptyState>
				{#snippet icon()}<Compass
						size={22}
						class="text-muted/60 mb-2"
					/>{/snippet}
				<p class="text-sm">
					No room has listed itself yet. A room is invite-only until its owner
					chooses otherwise, which is the default and stays the default.
				</p>
				{#snippet cta()}
					<a href="/home#rooms" class="btn btn-secondary"
						>Open a room of your own</a
					>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="mt-6 space-y-2">
			{#each rooms as room (room.slug)}
				<li>
					<a
						href="/r/{room.slug}"
						class="border-muted/15 hover:border-muted/40 flex items-center gap-3 rounded-lg border px-4 py-3"
					>
						<RoomIcon icon={room.icon} size={18} />
						<span class="min-w-0 truncate text-sm font-medium">{room.name}</span
						>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
