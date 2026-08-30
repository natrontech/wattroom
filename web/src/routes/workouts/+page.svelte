<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/components/zones';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { byFocus, focuses, library, type Focus } from '$lib/workout/library';
	import { createCustomStore } from '$lib/workout/custom.svelte';

	// FTP only scales the preview here; the ride screen owns the real value (#16).
	const previewFtp = 265;

	const custom = createCustomStore();
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

	<!-- Yours first: they are the ones you had to make on purpose. -->
	<section class="mt-6">
		<div class="flex items-baseline gap-3">
			<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
				your workouts
			</h2>
			<a href="/workouts/edit" class="text-xs underline hover:text-white"
				>New workout</a
			>
		</div>
		{#if custom.all.length === 0}
			<p
				class="text-muted border-muted/10 mt-2 rounded-lg border border-dashed px-5 py-4 text-xs"
			>
				Nothing yet. Build one from scratch, or open any workout below and save
				a copy — it lands on your account and follows you to any device.
			</p>
		{:else}
			<ul class="mt-2 grid gap-2">
				{#each custom.all as entry (entry.id)}
					<li
						class="border-muted/15 bg-surface-raised flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-5 py-3"
					>
						<a
							href="/ride?w={entry.id}"
							class="font-display font-bold hover:underline"
							>{entry.workout.name}</a
						>
						<span class="text-muted font-mono text-xs tabular-nums"
							>{formatClock(durationSeconds(entry.workout))}</span
						>
						<a
							href="/workouts/edit?w={entry.id}"
							class="text-muted ml-auto text-xs hover:text-white">Edit</a
						>
						<button
							onclick={() => void custom.remove(entry.id)}
							class="text-muted text-xs hover:text-white">Delete</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<h2 class="text-muted mt-8 text-[10px] tracking-[0.2em] uppercase">
		curated
	</h2>
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
			<li
				class="border-muted/15 bg-surface-raised hover:border-muted/40 overflow-hidden rounded-lg border transition-colors"
			>
				<!-- Not one big anchor: the card carries two actions, and nesting them
				     inside a link is invalid and unreachable by keyboard. -->
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
					<a
						href="/ride?w={entry.id}"
						class="font-display font-bold hover:underline"
						>{entry.workout.name}</a
					>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>{entry.focus}</span
					>
					<span class="text-muted ml-auto font-mono text-xs tabular-nums"
						>{formatClock(durationSeconds(entry.workout))}</span
					>
					<a
						href="/workouts/edit?from={entry.id}"
						class="text-muted text-xs hover:text-white">Save a copy</a
					>
					<!-- The primary action, visible (#126): the title-only link read
					     as a label, and the rest of the card was dead surface. -->
					<a
						href="/ride?w={entry.id}"
						class="rounded bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-white/90"
						>Ride</a
					>
				</div>
				<p class="text-muted px-5 pt-1 pb-3 text-xs">{entry.summary}</p>
				<IntervalGraph
					segments={flatten(entry.workout)}
					total={durationSeconds(entry.workout)}
					elapsed={0}
					ftp={previewFtp}
					trace={[]}
					compact
				/>
			</li>
		{/each}
	</ul>
</main>
