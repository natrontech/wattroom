<script lang="ts">
	// A session (#2450, ADR-0058): a workout on a shared timeline, running in
	// one voice channel. Its address is its own — the link a rider shares,
	// the one a notification opens — and its page is that channel's live
	// shell with the ride in front: the same connection, so stepping between
	// the channel and its session keeps you where you are.
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import VoiceChannelShell from '$lib/room/VoiceChannelShell.svelte';
	import type { SessionPageData } from '$lib/session/session-page';

	let { children } = $props();

	const crewId = $derived(page.params.id ?? '');
	const data = $derived(page.data as SessionPageData);
</script>

{#if data.session && data.voice}
	<VoiceChannelShell
		{crewId}
		channelId={data.session.channel}
		initial={data.voice}
	>
		{@render children()}
	</VoiceChannelShell>
{:else}
	<main class="page">
		{#if data.error}
			<Banner tone="error">
				{data.error}
				{#snippet action()}
					<button onclick={() => location.reload()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		{:else}
			<!-- A session lives as long as it runs (ADR-0058): what it leaves is
			     a recap and the rides, and this says where they are rather than
			     showing a blank. -->
			<h1 class="page-title-sm">This session has ended</h1>
			<p class="text-muted mt-2 text-sm">
				Its recap is on the crew’s <a
					href="/crew/{crewId}/members"
					class="underline">Members</a
				>
				page, and your ride is in
				<a href="/history" class="underline">Rides</a>.
			</p>
			<a href="/crew/{crewId}" class="btn btn-secondary mt-4"
				>Back to the crew</a
			>
		{/if}
	</main>
{/if}
