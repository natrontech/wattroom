<script lang="ts">
	/**
	 * A sprint over the world, as one moment card (D12, #3668): top-centre
	 * when it fits, otherwise under the seat — RidingSurface places it. Over
	 * the flat surface the sprint takes the focus whole (SprintMoment); here
	 * the world keeps the screen, so the card says only what the moment is.
	 * No watts on it: your 3 s power stays the one figure, in the computer's
	 * head (G2), and the card's border is watt while the window is open.
	 */
	import type { LiveRider } from '$lib/channel/types';
	import { wkg } from '$lib/format';
	import type { SprintState } from '$lib/protocol';
	import { serverNow } from '$lib/server-clock';
	import { sprintPhase } from '$lib/session/sprint-phase';

	let {
		sprint,
		roster = [],
	}: {
		sprint: SprintState;
		/** The session's riders, for the leader — absent riding alone. */
		roster?: LiveRider[];
	} = $props();

	let now = $state(serverNow());
	$effect(() => {
		const id = setInterval(() => (now = serverNow()), 250);
		return () => clearInterval(id);
	});

	const phase = $derived(sprintPhase(sprint, now));
	// Ranked on w/kg, the fair ordering for mixed groups (docs/SPEC.md).
	const leader = $derived(
		[...roster].sort((a, b) => b.watts / b.kg - a.watts / a.kg)[0],
	);
	const WORDS = 'text-2xl leading-7';
</script>

<!-- One state change a rider does not watch for (#1593): said once, not ticked. -->
<p class="sr-only" role="status">
	{phase === 'klaxon'
		? 'Sprint moment starting: fifteen seconds at everything you have'
		: phase === 'live'
			? 'Sprint moment open'
			: 'Sprint moment over'}
</p>
<div
	data-testid="moment-card"
	data-phase={phase}
	class="flex min-w-[300px] flex-col gap-1 rounded-[11px] px-4 py-3"
	style:box-shadow={phase === 'live'
		? 'inset 0 0 0 1px var(--color-watt)'
		: undefined}
>
	{#if phase === 'klaxon'}
		<p class="ride-label">Sprint · armed</p>
		<p class={WORDS}>
			Starts in <span class="num text-4xl leading-none font-bold"
				>{Math.max(0, Math.ceil((sprint.startsAtMs - now) / 1000))}</span
			> s
		</p>
		<p class="text-muted {WORDS}">15 s all out · the trainer lets go</p>
	{:else if phase === 'live'}
		<p class="ride-label">Sprint · all out</p>
		<p class={WORDS}>
			<span class="num text-4xl leading-none font-bold"
				>{Math.max(0, (sprint.endsAtMs - now) / 1000).toFixed(0)}</span
			> s left
		</p>
		{#if leader}
			<p class="text-muted {WORDS} truncate">
				{leader.name} leads ·
				<span class="num text-ink">{wkg(leader.watts, leader.kg)}</span> W/kg
			</p>
		{/if}
	{:else if sprint.results}
		<p class="ride-label">Sprint podium</p>
		<ol class={WORDS}>
			{#each sprint.results.slice(0, 3) as score, i (score.riderId)}
				<li class="flex gap-3">
					<span class="num text-muted w-5">{i + 1}</span>
					<span class="min-w-0 flex-1 truncate">{score.name}</span>
					<span class="num">{score.wkg.toFixed(1)}</span>
					<span class="text-muted">W/kg</span>
				</li>
			{/each}
		</ol>
	{/if}
</div>
