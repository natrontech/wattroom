<script lang="ts">
	// The crew's door (ADR-0038 amended, #1236): what a share link opens onto.
	// One decision, one button — the shape the room's door had when it was
	// the golden path. Signed-out visitors meet the login gate first and come
	// back here with the code intact.
	import { goto } from '$app/navigation';
	import Logo from '$lib/brand/Logo.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import { joinCrew } from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function join() {
		busy = true;
		const res = await joinCrew(data.code);
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		presence.reload();
		await goto(`/crew/${res.data.id}`);
	}
</script>

<svelte:head>
	<title
		>{data.crew ? `Join ${data.crew.name}` : 'Join a crew'} · WattRoom</title
	>
</svelte:head>

<main class="grid min-h-full place-items-center px-6">
	<div class="panel w-full max-w-md px-6 py-10 text-center">
		<Logo size={40} />
		{#if data.crew}
			<span
				class="bg-ink/5 text-ink/80 mx-auto mt-5 grid h-12 w-12 place-items-center rounded-xl"
				aria-hidden="true"
			>
				{#if data.crew.icon}
					<RoomIcon icon={data.crew.icon} size={22} />
				{:else}
					<span class="font-display text-xl font-bold"
						>{data.crew.name.slice(0, 1).toUpperCase()}</span
					>
				{/if}
			</span>
			<h1 class="font-display mt-3 text-2xl font-bold">{data.crew.name}</h1>
			<p class="text-muted mt-2 text-sm">
				You have been invited to ride with this crew{data.crew.members > 1
					? ` — ${data.crew.members} people are in it`
					: ''}.
			</p>
			<button onclick={join} disabled={busy} class="btn btn-primary btn-lg mt-6"
				>Join {data.crew.name}</button
			>
			{#if error}<p class="text-danger mt-4 text-sm">{error}</p>{/if}
			<!-- Privacy is architecture (WATTROOM.md): say what joining shows
			     before the button. Joining a crew shows nobody anything yet. -->
			<p class="text-muted/70 mt-4 text-[11px]">
				Joining shows nobody your numbers. Your watts are visible to a room
				while you ride in it, and nowhere else.
			</p>
		{:else}
			<p class="mt-6 text-sm">{data.error}</p>
			<a
				href="/home"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to your crews</a
			>
		{/if}
	</div>
</main>
