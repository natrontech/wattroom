<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { type MockRider, targetState } from '$lib/room/mockcompat';

	let { riders }: { riders: MockRider[] } = $props();

	/**
	 * WATTROOM.md: the execution meter is the live version of the ride's score — the
	 * contest is who rides their own workout cleanest, which works across any fitness
	 * gap. Sorted, because a leaderboard nobody can win is not a leaderboard.
	 */
	const ranked = $derived(
		[...riders]
			.map((rider) => ({
				name: rider.name,
				you: rider.you,
				pct: Math.round(rider.execution * 100),
				inBand: targetState(rider).inBand,
			}))
			.sort((a, b) => b.pct - a.pct),
	);
</script>

<div class="bg-surface-raised ring-ink/10 rounded-lg p-4 ring-1">
	<p class="eyebrow">execution</p>
	<ul class="mt-3 space-y-1.5">
		{#each ranked as entry (entry.name)}
			<li class="flex items-center gap-2.5">
				<span
					class="w-12 shrink-0 truncate text-[11px] {entry.you
						? 'text-ink'
						: 'text-muted'}">{entry.name}</span
				>
				<ProgressBar
					pct={entry.pct}
					track="bg-surface"
					fill="{entry.you
						? 'bg-watt'
						: 'bg-neon/60'} transition-[width] duration-500"
					class="flex-1"
				/>
				<!-- A dot for whether they are inside the band right now, not just cumulatively. -->
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full {entry.inBand
						? 'bg-z4'
						: 'bg-muted/30'}"
					title={entry.inBand ? 'in band' : 'off target'}
				></span>
				<span class="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums"
					>{entry.pct}%</span
				>
			</li>
		{/each}
	</ul>
</div>
