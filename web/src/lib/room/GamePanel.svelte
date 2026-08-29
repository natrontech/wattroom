<script lang="ts">
	import { play } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import { formatClock, ZONE_NAMES } from '$lib/components/zones';
	import type { GameState, Rider } from '$lib/protocol';

	// One panel for all seven modes (#31): the server owns every rule, this
	// renders labels. Mode-specific vocabulary comes from docs/SPEC.md.
	let {
		game,
		roster,
		end,
		canControl,
	}: {
		game: GameState;
		roster: Rider[];
		end: () => void;
		canControl: boolean;
	} = $props();

	const MODE_LABEL: Record<string, string> = {
		'backyard-ramp': 'Backyard Ramp',
		'collective-ramp': 'Collective Ramp',
		'floor-is-lava': 'Floor is Lava',
		'watt-golf': 'Watt Golf',
		'sprint-roulette': 'Sprint Roulette',
		'points-race': 'Points Race',
		'team-relay': 'Team Relay',
	};

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(id);
	});
	const roundLeft = $derived(
		game.roundEndsAtMs ? Math.max(0, (game.roundEndsAtMs - now) / 1000) : 0,
	);

	const name = (id: string) => roster.find((r) => r.id === id)?.name ?? 'rider';

	// Eliminations announce themselves — the rider is not watching the screen.
	let knownOut = new Set<string>();
	$effect(() => {
		const out = Object.entries(game.riders ?? {}).filter(
			([, r]) => r.eliminated,
		);
		for (const [id] of out) {
			if (!knownOut.has(id)) {
				knownOut.add(id);
				play('elimination');
			}
		}
		if (game.phase === 'done' && game.podium?.length) play('fanfare');
	});
</script>

<div
	class="border-neon/40 bg-surface-raised mt-4 rounded-lg border-2 px-5 py-4"
>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
		<span class="font-display font-bold"
			>{MODE_LABEL[game.mode] ?? game.mode}</span
		>
		{#if game.phase === 'running'}
			{#if game.round}
				<span class="text-muted text-sm">round {game.round}</span>
			{/if}
			{#if game.linePct}
				<span class="font-display text-watt glow-text text-lg font-bold"
					>{Math.round(game.linePct * 100)}% FTP</span
				>
			{/if}
			{#if game.calledZone}
				<span class="font-display text-lg font-bold"
					>Z{game.calledZone}
					<span class="text-muted text-xs">{ZONE_NAMES[game.calledZone]}</span
					></span
				>
			{/if}
			{#if game.roundEndsAtMs}
				<span class="text-muted font-mono text-sm tabular-nums"
					>{formatClock(Math.round(roundLeft))}</span
				>
			{/if}
			{#if game.roomDistance}
				<span class="font-display text-sm font-bold tabular-nums"
					>{Math.round(game.roomDistance / 1000)} kJ front</span
				>
			{/if}
		{/if}
		{#if canControl}
			<button
				onclick={end}
				class="border-muted/30 hover:border-muted/60 ml-auto rounded border px-3 py-1 text-xs"
				>End game</button
			>
		{/if}
	</div>

	{#if game.phase === 'done' && game.podium}
		<ol class="mt-3 grid gap-1">
			{#each game.podium.slice(0, 5) as score, i (score.riderId)}
				<li class="flex items-baseline gap-2 text-sm">
					<span class="text-muted w-5"
						>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span
					>
					<span>{score.name}</span>
				</li>
			{/each}
		</ol>
	{:else}
		<div class="mt-2 flex flex-wrap gap-2">
			{#each Object.entries(game.riders ?? {}) as [id, rider] (id)}
				<span
					class="rounded-full border px-2.5 py-1 text-xs {rider.eliminated
						? 'border-z6/40 text-z6 line-through'
						: rider.onFront
							? 'border-watt/60 text-watt'
							: 'border-muted/20'}"
				>
					{name(id)}
					{#if rider.lives}· {'♥'.repeat(rider.lives)}{/if}
					{#if rider.score}· {rider.score.toFixed(0)}{/if}
					{#if id === account.me?.id && rider.targetPct}
						· yours {Math.round(rider.targetPct * 100)}%{/if}
				</span>
			{/each}
		</div>
	{/if}
</div>
