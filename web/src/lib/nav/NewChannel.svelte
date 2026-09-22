<script lang="ts">
	// A new channel in the crew on screen (#2447): the + beside CHANNELS or
	// VOICE, Discord's "Create Channel" in the server you are looking at. The
	// crew's owner and admins keep its channels (ADR-0058), so only they are
	// offered it; gating, ordering and deleting are the crew's settings (#2454).
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { MaxChannelNameChars } from '$lib/protocol';
	import { crewLive } from './crew-live.svelte';

	let {
		crew,
		kind,
	}: { crew: { id: string; name: string }; kind: 'text' | 'voice' } = $props();

	let name = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function create() {
		busy = true;
		const res = await api<{ id: string }>(`/api/crews/${crew.id}/channels`, {
			method: 'POST',
			json: { kind, name: name.trim(), private: false },
		});
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		void crewLive.reload();
		void goto(`/crew/${crew.id}/${kind === 'text' ? 'c' : 'v'}/${res.data.id}`);
	}
</script>

<h3 class="font-display font-bold">
	New {kind} channel<span class="text-muted font-normal"
		>&nbsp;in {crew.name}</span
	>
</h3>
<p class="text-muted mt-1 text-xs">
	{kind === 'text'
		? 'A place to write, open to the whole crew. Make it private in Settings.'
		: 'A place to ride and talk, with its own music, open to the whole crew. Make it private in Settings.'}
</p>
{#if error}
	<div class="mt-3"><Banner tone="error">{error}</Banner></div>
{/if}
<form
	onsubmit={(e) => {
		e.preventDefault();
		void create();
	}}
>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		bind:value={name}
		maxlength={MaxChannelNameChars}
		class="input mt-3 w-full"
		placeholder="Channel name"
		aria-label="channel name"
		autofocus
	/>
	<button disabled={busy || !name.trim()} class="btn btn-primary mt-3 w-full"
		>Create the channel</button
	>
</form>
