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

<!-- One line in the Ride card (#3671): the doors, and where they open. -->
<section
	class="flex flex-wrap items-center gap-x-2 gap-y-1"
	data-testid="solo-games"
>
	<h2 class="text-sm font-semibold">
		{room ? `A game alone, in ${room.name} with your mic off:` : 'A game:'}
	</h2>
	{#if !crewLive.loaded}
		{#each modes as mode (mode.id)}<Skeleton class="h-11 w-32" />{/each}
	{:else if room}
		{#each modes as mode (mode.id)}
			{@const Icon = mode.icon}
			<button
				onclick={() => play(mode.id)}
				title="{mode.blurb} Anyone who opens {room.name} can join; alone, the game shows your own score."
				class="btn btn-ghost btn-lg"><Icon size={18} /> {mode.label}</button
			>
		{/each}
	{:else if crewLive.error && crewLive.crews.length === 0}
		<span class="text-muted text-sm">
			{crewLive.error}
			<button onclick={() => void crewLive.reload()} class="btn-link"
				>Retry</button
			>
		</span>
	{:else}
		<!-- Capability gating (ux.md): no door that fails on click, and the one
		     line that says why — hidden rather than disabled, so the card's
		     games stay one line (TARGETS ride-preride 9, #3671). -->
		<span class="text-muted text-sm" data-testid="solo-games-hint">
			Games run in a crew's voice channel. <a href="/home" class="btn-link"
				>Start a crew</a
			>.
		</span>
	{/if}
</section>
