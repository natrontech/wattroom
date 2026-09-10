<script lang="ts">
	// The crew's door (ADR-0038 amended, #1236): what a share link opens onto.
	// One decision, one button — the shape the room's door had when it was
	// the golden path. Signed-out visitors meet the login gate first and come
	// back here with the code intact.
	import { goto, invalidateAll } from '$app/navigation';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import { fetchCrew, joinCrew } from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import type { PageData } from './$types';
	import { reachable } from '$lib/nav/crews';

	let { data }: { data: PageData } = $props();
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function join() {
		error = null;
		busy = true;
		const res = await joinCrew(data.code);
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		presence.reload();
		// A one-room crew lands you in the room you came for (#1931), not on
		// a roster with a code above it; anything else, the crew page.
		const crew = await fetchCrew(res.data.id);
		const doors = crew.ok
			? crew.data.rooms.filter((room) => room.slug && reachable(room.access))
			: [];
		await goto(
			doors.length === 1 ? `/r/${doors[0].slug}` : `/crew/${res.data.id}`,
		);
	}
</script>

<svelte:head>
	<title
		>{data.crew
			? data.crew.inCrew || data.crew.banned
				? data.crew.name
				: `Join ${data.crew.name}`
			: 'Join a crew'} · WattRoom</title
	>
</svelte:head>

<main class="grid min-h-full place-items-center px-6">
	<div class="panel w-full max-w-md px-6 py-10 text-center">
		<Logo size={40} />
		{#if data.crew}
			<div class="mt-5 flex justify-center">
				<CrewMark
					name={data.crew.name}
					icon={data.crew.icon}
					imageUrl={data.crew.imageUrl}
					size={48}
					class="rounded-xl"
				/>
			</div>
			<h1 class="font-display mt-3 text-2xl font-bold">{data.crew.name}</h1>
			{#if data.crew.inCrew && data.crew.id}
				<!-- Your own crew's link, followed again: the door is already
				     open, so the button is the page, not a Join that does nothing. -->
				<p class="text-muted mt-2 text-sm">
					You are in this crew{data.crew.members > 1
						? ` with ${data.crew.members - 1} ${data.crew.members === 2 ? 'other' : 'others'}`
						: ''}.
				</p>
				<a href="/crew/{data.crew.id}" class="btn btn-primary btn-lg mt-6"
					>Open {data.crew.name}</a
				>
			{:else if data.crew.banned}
				<!-- Said at the door, not on the click (audit 2026-09-09): the
				     Join this used to offer was refused every time. -->
				<p class="text-muted mt-2 text-sm">
					This crew removed you. Its code will not let you back in.
				</p>
				<a href="/home" class="btn btn-secondary btn-lg mt-6"
					>Back to your rooms</a
				>
			{:else}
				<p class="text-muted mt-2 text-sm">
					You have been invited to ride with this crew{data.crew.members > 1
						? ` — ${data.crew.members} people are in it`
						: ''}.
				</p>
				<button
					onclick={join}
					disabled={busy}
					class="btn btn-primary btn-lg mt-6">Join {data.crew.name}</button
				>
				{#if error}<p class="text-danger mt-4 text-sm">{error}</p>{/if}
				<!-- Privacy is architecture (WATTROOM.md): say what joining shows
				     before the button. Joining a crew shows nobody anything yet. -->
				<p class="text-muted/70 mt-4 text-[11px]">
					Joining shows nobody your numbers. Your watts are visible to a room
					while you ride in it, and nowhere else.
				</p>
			{/if}
		{:else if data.errorCode && data.errorCode !== 'not_found'}
			<div class="mt-6 text-left">
				<Banner tone="error">
					{data.error}
					{#snippet action()}
						<button
							onclick={() => void invalidateAll()}
							class="btn-link text-xs">Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else}
			<p class="mt-6 text-sm">{data.error}</p>
			<a
				href="/home"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to your rooms</a
			>
		{/if}
	</div>
</main>
