<script lang="ts">
	import { play } from '$lib/sound/cues';
	import type { SprintState } from '$lib/protocol';

	// The sprint moment overlay (#30): klaxon countdown, the 15 s window, the
	// mini-podium. Times come as server-clock anchors; local now is close
	// enough for display (the scoring happens server-side).
	let {
		sprint,
		myWatts,
		silent = false,
	}: {
		sprint: SprintState;
		myWatts: number;
		/** The /dev gallery mounts this without a ride — no klaxon there. */
		silent?: boolean;
	} = $props();

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(id);
	});

	const phase = $derived(
		now < sprint.startsAtMs
			? 'klaxon'
			: now < sprint.endsAtMs
				? 'live'
				: 'podium',
	);
	const countdown = $derived(Math.ceil((sprint.startsAtMs - now) / 1000));
	const remaining = $derived(Math.max(0, (sprint.endsAtMs - now) / 1000));

	// The klaxon sounds once when the sprint arms, go once at the gun.
	let heard = $state<string | null>(null);
	$effect(() => {
		if (silent) return;
		if (phase === 'klaxon' && heard === null) {
			heard = 'klaxon';
			play('klaxon');
		}
		if (phase === 'live' && heard === 'klaxon') {
			heard = 'go';
			play('go');
		}
		if (phase === 'podium' && heard === 'go') {
			heard = 'podium';
			play('fanfare');
		}
	});
</script>

{#if phase === 'klaxon'}
	<div
		class="border-watt/50 bg-surface-raised mt-4 rounded-lg border-2 px-5 py-4 text-center"
	>
		<p class="text-muted text-[10px] tracking-[0.3em] uppercase">sprint in</p>
		<p
			class="text-watt glow-text-strong font-display text-6xl font-bold tabular-nums"
		>
			{countdown}
		</p>
	</div>
{:else if phase === 'live'}
	<div
		class="border-watt/50 bg-surface-raised mt-4 rounded-lg border-2 px-5 py-4 text-center"
	>
		<p class="text-muted text-[10px] tracking-[0.3em] uppercase">
			all out — {remaining.toFixed(1)}s
		</p>
		<p
			class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
		>
			{myWatts}
		</p>
	</div>
{:else if sprint.results}
	<div
		class="border-muted/20 bg-surface-raised mt-4 rounded-lg border px-5 py-4"
	>
		<p class="text-muted text-[10px] tracking-[0.3em] uppercase">
			sprint podium
		</p>
		<ol class="mt-2 grid gap-1">
			{#each sprint.results.slice(0, 5) as score, i (score.riderId)}
				<li class="flex items-baseline gap-2 text-sm">
					<span class="text-muted w-5"
						>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span
					>
					<span class="font-medium">{score.name}</span>
					<span
						class="font-display ml-auto font-bold tabular-nums {i === 0
							? 'text-watt glow-text'
							: ''}">{score.wkg.toFixed(1)} w/kg</span
					>
					<span class="text-muted text-xs tabular-nums">{score.watts} W</span>
				</li>
			{/each}
		</ol>
	</div>
{/if}
