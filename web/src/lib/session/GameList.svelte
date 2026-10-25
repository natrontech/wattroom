<script lang="ts">
	import { GAME_MODES, RACES, type GameStart } from './modes';

	/**
	 * The session picker's Games tab: the seven %FTP games, each started off
	 * a road, and the way to the races, which ride one (#3777, ADR-0067).
	 */
	let {
		running,
		onStart,
		onRace,
	}: {
		running: boolean;
		onStart: (game: GameStart) => void;
		/** Opens the Roads tab on Race it. */
		onRace: () => void;
	} = $props();
</script>

<div class="min-h-0 flex-1 overflow-y-auto p-4">
	{#if running}
		<p class="text-muted mb-3 text-xs">
			A game is already running — end it before starting another.
		</p>
	{/if}
	<div class="grid gap-2 sm:grid-cols-2">
		{#each GAME_MODES as game (game.id)}
			<div class="border-frame flex flex-col rounded-lg border px-4 py-3">
				<p class="font-display flex items-center gap-2 text-sm font-bold">
					<game.icon size={15} class="text-neon shrink-0" />
					{game.label}
				</p>
				<p class="text-muted mt-1 flex-1 text-xs leading-relaxed">
					{game.blurb}
				</p>
				<button
					onclick={() => onStart({ gameMode: game.id })}
					disabled={running}
					class="btn btn-secondary btn-lg mt-3 self-start disabled:opacity-40"
					>Start game</button
				>
			</div>
		{/each}
	</div>
	<p
		class="text-muted mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
	>
		Races ride one of your roads: {RACES.map((r) => r.label).join(' · ')}.
		<button onclick={onRace} class="btn btn-secondary btn-xs"
			>Race on a road</button
		>
	</p>
</div>
