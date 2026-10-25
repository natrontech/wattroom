<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RaceNeutralSeconds } from '$lib/protocol';
	import { SESSION_COUNTDOWN_SECONDS } from '$lib/workout/ride-state';
	import { gameMode, type GameStart } from './modes';
	import PairFirst from './PairFirst.svelte';

	/**
	 * Race it's one action (#3777): a race opens its own session on the road
	 * (ADR-0067), so it starts only while nothing else holds the channel, and
	 * the line under it says what does.
	 */
	let {
		race,
		channelName,
		gameRunning,
		sessionOpen,
		busy,
		trainer,
		onStart,
	}: {
		race: GameStart;
		channelName: string;
		gameRunning: boolean;
		sessionOpen: boolean;
		busy: boolean;
		/** The pairing card while there is no trainer; Start is offered all
		 *  the same, as a coach may start a race and not ride it. */
		trainer?: Snippet;
		onStart: (race: GameStart) => void;
	} = $props();
	const name = $derived(gameMode(race.gameMode)?.label ?? 'the race');
	const held = $derived(
		gameRunning
			? 'A game is running: end it before starting a race.'
			: sessionOpen
				? 'A session is running: a race opens its own once it ends.'
				: null,
	);
</script>

<PairFirst {trainer} why="a race places you by your watts" />
<div class="flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium">
			It runs in {channelName}: anyone there can join it before the flag.
		</p>
		<p class="text-muted mt-1 text-xs">
			{held ??
				`A ${SESSION_COUNTDOWN_SECONDS} s countdown, then ${RaceNeutralSeconds / 60} neutral minutes to km 0.`}
		</p>
	</div>
	<button
		onclick={() => onStart(race)}
		disabled={busy || !!held}
		class="btn {trainer ? 'btn-secondary' : 'btn-accent'} btn-lg shrink-0"
		>{trainer ? 'Start without a trainer' : `Start ${name}`}</button
	>
</div>
