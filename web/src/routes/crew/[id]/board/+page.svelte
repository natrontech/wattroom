<script lang="ts">
	// The crew's Board (#2455, ADR-0058): what the crew wrote down — the
	// newest announcement across its text channels, then its pins. The
	// notice leads because it is the thing with a clock on it; it names the
	// channel it was marked in, which is where the conversation around it is.
	//
	// Sections, not a union (#2413's argument): the notice and the pins have
	// different owners and permissions, and the page composes them. Owns the
	// crew's four states (errors.md); CrewPins owns the pins'.
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import AnnouncementStrip from '$lib/announce/AnnouncementStrip.svelte';
	import { takeDownAnnouncement } from '$lib/announce/take-down';
	import {
		fetchCrewAnnouncement,
		textChannelPath,
		type CrewAnnouncement,
	} from '$lib/channels';
	import Banner from '$lib/components/Banner.svelte';
	import CrewPins from '$lib/pins/CrewPins.svelte';
	import { presence } from '$lib/presence.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let announcement = $state<CrewAnnouncement | null>(
		untrack(() => data.announcement),
	);
	$effect(() => {
		announcement = data.announcement;
	});
	const administers = $derived(
		data.crew?.role === 'owner' || data.crew?.role === 'admin',
	);

	async function reread() {
		const res = await fetchCrewAnnouncement(id);
		// A failed re-read keeps the notice you are reading.
		if (res.ok) announcement = res.data ?? null;
	}
	// Marking or clearing one pings the lobby with its channel (#2435).
	let heard = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === heard) return;
		heard = version;
		untrack(() => void reread());
	});

	// The re-read, not a local null: taking the newest down can surface the
	// next one from another channel.
	const clear = () =>
		announcement &&
		takeDownAnnouncement(
			announcement.channelId,
			announcement.messageId,
			reread,
		);
</script>

<svelte:head>
	<title>Board · {data.crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if data.error && data.errorCode === 'not_found'}
		<Banner tone="error">
			{data.error}
			{#snippet action()}
				<a href="/home" class="btn-link text-xs">Home</a>
			{/snippet}
		</Banner>
	{:else if data.error || !data.crew}
		<Banner tone="error">
			{data.error ?? 'The crew could not be loaded.'}
			{#snippet action()}
				<button onclick={() => void invalidateAll()} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else}
		<h1 class="page-title mb-1">Board</h1>
		<p class="text-muted mb-5 text-xs">What {data.crew.name} wrote down.</p>

		{#if announcement}
			<AnnouncementStrip
				{announcement}
				canClear={administers}
				onclear={() => void clear()}
			/>
			<p class="text-muted -mt-2 mb-5 text-xs">
				Marked in
				<a
					href={textChannelPath(data.crew.id, announcement.channelId)}
					class="btn-link">{announcement.channelName}</a
				>
			</p>
		{/if}

		<CrewPins crewId={data.crew.id} crewName={data.crew.name} />
	{/if}
</main>
