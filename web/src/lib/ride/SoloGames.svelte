<script lang="ts">
	// A game from the solo ride (#3276): the three modes that make sense
	// alone. Picking one is a pick, as a workout is (#4539): the card's Start
	// counts it in, and it runs on this ride alone, its score kept by the hub
	// on the rider's own lane. It used to open the crew's lounge and start a
	// session there at once, which the crew saw. Alone, it shows your own
	// score; medals need three riders (docs/SPEC.md).
	import { GAME_MODES } from '#lib/session/modes.ts';
	import { SOLO_GAMES } from '#lib/ride/solo-game.svelte.ts';

	let {
		picked,
		onpick,
	}: {
		/** The game the card's Start starts, or null for none. */
		picked: string | null;
		onpick: (mode: string) => void;
	} = $props();

	const modes = GAME_MODES.filter((mode) => SOLO_GAMES.includes(mode.id));
</script>

<!-- One line in the Ride card (#3671): the games, each a pick. -->
<section
	class="flex flex-wrap items-center gap-x-2 gap-y-1"
	data-testid="solo-games"
	aria-label="a game alone"
>
	<h2 class="text-sm font-semibold">A game alone:</h2>
	{#each modes as mode (mode.id)}
		{@const Icon = mode.icon}
		<button
			onclick={() => onpick(mode.id)}
			aria-pressed={picked === mode.id}
			title="{mode.blurb} On your screen only: your own score."
			class="btn btn-lg rounded-full border {picked === mode.id
				? 'border-neon text-ink'
				: 'border-muted/30 hover:border-muted/60'}"
			><Icon size={18} /> {mode.label}</button
		>
	{/each}
</section>
