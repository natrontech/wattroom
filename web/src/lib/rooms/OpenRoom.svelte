<script lang="ts">
	// Opening a room in a crew you own or administer (#1201): the crew page's
	// "Open a room here" and the sidebar's + beside the rooms of the crew on
	// screen. Getting into a crew in the first place is OpenOrJoin's.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { presence } from '$lib/presence.svelte';

	let { crew }: { crew: { id: string; name: string } } = $props();

	let roomName = $state('');
	let roomBusy = $state(false);
	let roomError = $state<string | null>(null);
	// docs/SPEC.md ownership cap: at the cap the affordance disables with the
	// reason, instead of a 409 on click (ux.md capability gating). The number
	// is the server's, carried on the room list (#603). 0 means the list has
	// not landed yet: gate open, and the refusal still backs it up.
	const owned = $derived(
		presence.rooms.filter((room) => room.role === 'owner').length,
	);
	const ownedOut = $derived(
		presence.maxOwned > 0 && owned >= presence.maxOwned,
	);
	async function openRoom() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: { name: roomName, crewId: crew.id },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}
</script>

<h3 class="font-display font-bold">
	Open a room<span class="text-muted font-normal">&nbsp;in {crew.name}</span>
</h3>
<p class="text-muted mt-1 text-xs">
	Open to the crew from the start. Anyone new joins the crew with its code or
	link — rooms have none of their own.
</p>
{#if roomError}
	<div class="mt-3"><Banner tone="error">{roomError}</Banner></div>
{/if}
<form
	onsubmit={(e) => {
		e.preventDefault();
		void openRoom();
	}}
>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		id="open-room-name-sheet"
		bind:value={roomName}
		maxlength="60"
		class="input mt-3 w-full"
		placeholder="Room name"
		aria-label="room name"
		autofocus
	/>
	<button
		disabled={roomBusy || !roomName.trim() || ownedOut}
		class="btn btn-primary mt-3 w-full">Open a room</button
	>
	{#if ownedOut}
		<p class="text-muted mt-2 text-xs">
			You own {owned} rooms — the cap. Delete one to open another.
		</p>
	{/if}
</form>
