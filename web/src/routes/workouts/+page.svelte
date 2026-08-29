<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/components/zones';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { byFocus, focuses, library, type Focus } from '$lib/workout/library';

	// FTP only scales the preview here; the ride screen owns the real value (#16).
	const previewFtp = 265;

	let active = $state<Focus | 'All'>('All');
	const shown = $derived(
		active === 'All'
			? [...library].sort(
					(a, b) => durationSeconds(a.workout) - durationSeconds(b.workout),
				)
			: byFocus(active),
	);
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Workouts</h1>
			<p class="text-muted text-xs">
				{library.length} sessions · every target scales to your FTP
			</p>
		</div>
	</div>

	<div class="mt-6 flex flex-wrap gap-1">
		{#each ['All', ...focuses] as option (option)}
			<button
				onclick={() => (active = option as Focus | 'All')}
				class="rounded px-3 py-1.5 text-xs {active === option
					? 'bg-surface-raised text-white'
					: 'text-muted hover:text-white'}">{option}</button
			>
		{/each}
	</div>

	<ul class="mt-4 grid gap-3">
		{#each shown as entry (entry.id)}
			<li>
				<a
					href="/ride?w={entry.id}"
					class="border-muted/15 bg-surface-raised hover:border-muted/40 block overflow-hidden rounded-lg border transition-colors"
				>
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
						<span class="font-display font-bold">{entry.workout.name}</span>
						<span class="text-muted text-[10px] tracking-wider uppercase"
							>{entry.focus}</span
						>
						<span class="text-muted ml-auto font-mono text-xs tabular-nums"
							>{formatClock(durationSeconds(entry.workout))}</span
						>
					</div>
					<p class="text-muted px-5 pt-1 pb-3 text-xs">{entry.summary}</p>
					<!-- The graph is what a rider recognises; the name is what they search. -->
					<IntervalGraph
						segments={flatten(entry.workout)}
						total={durationSeconds(entry.workout)}
						elapsed={0}
						ftp={previewFtp}
						trace={[]}
						compact
					/>
				</a>
			</li>
		{/each}
	</ul>
</main>
