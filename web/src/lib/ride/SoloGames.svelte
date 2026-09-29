<script lang="ts">
	// A game from the solo ride (#3276): the three modes that make sense
	// alone. A game is a session, and a session runs in a voice channel —
	// there is no rider-scoped room (WATTROOM.md), so the door opens your
	// lounge (#3274's rule) with the mic off and starts the game there, with
	// you as its coach. Anyone who opens the channel can join, like any game.
	// Alone, it shows your own score; medals need three riders (docs/SPEC.md).
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { goto } from '$app/navigation';
	import { channelAddress } from '$lib/channel/address';
	import { askVoiceMuted } from '$lib/channel/voice-intent';
	import { lounge, loungeCrew } from '$lib/crew-lounge';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { GAME_MODES } from '$lib/session/modes';
	import { gameDoor } from '$lib/session/game-door';

	/** The modes a rider can play with nobody else there. */
	const SOLO = ['watt-golf', 'floor-is-lava', 'backyard-ramp'];
	const modes = GAME_MODES.filter((mode) => SOLO.includes(mode.id));

	if (!crewLive.loaded) void crewLive.reload();
	const crew = $derived(loungeCrew(crewLive.crews));
	const room = $derived(crew ? lounge(crew) : undefined);

	function play(mode: string) {
		if (!crew || !room) return;
		const address = channelAddress(crew.id, room.id, room.name);
		askVoiceMuted(address.key, Date.now());
		void goto(gameDoor(address.home, mode));
	}
</script>

<section class="mx-auto mt-6 w-full max-w-3xl" data-testid="solo-games">
	<h2 class="eyebrow">A game</h2>
	{#if !crewLive.loaded}
		<div class="mt-3 grid gap-3 sm:grid-cols-3">
			{#each modes as mode (mode.id)}<Skeleton class="h-11" />{/each}
		</div>
	{:else}
		<div class="mt-3 grid gap-3 sm:grid-cols-3">
			{#each modes as mode (mode.id)}
				{@const Icon = mode.icon}
				<button
					onclick={() => play(mode.id)}
					disabled={!room}
					title={mode.blurb}
					class="btn btn-secondary btn-lg w-full justify-center"
					><Icon size={18} /> {mode.label}</button
				>
			{/each}
		</div>
		{#if room}
			<p class="text-muted mt-2 text-xs">
				In {room.name}, with your mic off — anyone who opens it can join. Alone,
				the game shows your own score.
			</p>
		{:else if crewLive.error && crewLive.crews.length === 0}
			<p class="text-muted mt-2 text-xs">
				{crewLive.error}
				<button onclick={() => void crewLive.reload()} class="btn-link"
					>Retry</button
				>
			</p>
		{:else}
			<!-- Capability gating (ux.md): disabled with the one line that says
			     why, never a door that fails on click. -->
			<p class="text-muted mt-2 text-xs" data-testid="solo-games-hint">
				Games run in a crew's voice channel. <a href="/home" class="btn-link"
					>Start a crew</a
				>.
			</p>
		{/if}
	{/if}
</section>
