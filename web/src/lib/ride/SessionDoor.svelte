<script lang="ts">
	// The workout on the Ride card, ridden with the crew (#4224): Start the
	// ride rides it alone; this opens the lounge (#3274's rule) with the mic
	// off and its picker on the same workout and road, the one way a session
	// starts. Hidden with no lounge to open and on a phone, which only plans
	// (#1767): never a door that fails on click (ux.md).
	import { goto } from '$app/navigation';
	import { channelAddress } from '$lib/channel/address';
	import { askVoiceMuted } from '$lib/channel/voice-intent';
	import { lounge, loungeCrew, rememberDoor } from '$lib/crew-lounge';
	import { device } from '$lib/device.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { startDoor } from '$lib/session/doors';
	import Radio from '@lucide/svelte/icons/radio';

	let { pick, road }: { pick: string; road?: string } = $props();

	if (!crewLive.loaded) void crewLive.reload();
	const crew = $derived(loungeCrew(crewLive.crews));
	const room = $derived(crew ? lounge(crew) : undefined);

	function open() {
		if (!crew || !room) return;
		rememberDoor('lounge');
		const address = channelAddress(crew.id, room.id, room.name);
		askVoiceMuted(address.key, Date.now());
		void goto(startDoor(address.training, pick, road));
	}
</script>

{#if room && !device.spectator}
	<button onclick={open} class="btn btn-secondary btn-lg"
		><Radio size={15} /> Start a session in {room.name}</button
	>
{/if}
