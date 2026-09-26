<script lang="ts">
	// A text channel (#2448, ADR-0058): the crew's talk, read and written
	// over HTTP. Nothing to join — voice, the ride and the deck are a voice
	// channel's.
	import { invalidateAll } from '$app/navigation';
	import Banner from '$lib/components/Banner.svelte';
	import ChannelThread from '$lib/messages/ChannelThread.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title
		>{data.channel?.name ?? 'Channel'} · {data.crew?.name ?? 'Crew'} · WattRoom</title
	>
</svelte:head>

<main class="flex h-full min-h-0 flex-col">
	{#if data.error && data.errorCode === 'not_found'}
		<!-- Permanent: not a crew of yours, or none at all (#1677). -->
		<div class="p-5">
			<Banner tone="error">
				{data.error}
				{#snippet action()}
					<a href="/home" class="btn-link text-xs">Home</a>
				{/snippet}
			</Banner>
		</div>
	{:else if data.error}
		<div class="p-5">
			<Banner tone="error">
				{data.error}
				{#snippet action()}
					<button onclick={() => void invalidateAll()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if !data.crew || !data.channel}
		<!-- A channel you may not enter reads like one that is not there:
		     a private channel's existence is part of what its gate keeps. -->
		<div class="p-5">
			<Banner tone="error">
				No channel lives here.
				{#snippet action()}
					<a href="/crew/{data.crewId}" class="btn-link text-xs">The crew</a>
				{/snippet}
			</Banner>
		</div>
	{:else}
		<!-- Keyed: another channel is a new thread, not this one's draft and
		     scroll position with different lines in it. -->
		{#key data.channel.id}
			<ChannelThread crew={data.crew} channel={data.channel} />
		{/key}
	{/if}
</main>
