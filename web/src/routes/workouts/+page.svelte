<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/format';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { byFocus, focuses, library, type Focus } from '$lib/workout/library';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import type { Workout } from '$lib/workout/types';
	import { toasts } from '$lib/toast.svelte';
	import {
		fetchProgression,
		suggestedFocuses,
		type Suggestion,
	} from '$lib/progression';

	// FTP only scales the preview here; the ride screen owns the real value (#16).
	const previewFtp = 265;

	const custom = createCustomStore();
	let active = $state<Focus | 'All'>('All');

	// SPEC's "suggested for today" (#222): a badge with its one-clause why —
	// hidden through the cold start (the server withholds it), never a gate.
	let suggestion = $state<Suggestion | null>(null);
	void fetchProgression().then((r) => {
		if (r.ok) suggestion = r.data?.load?.suggestion ?? null;
	});
	const suggested = $derived(suggestedFocuses(suggestion));
	const shown = $derived(
		active === 'All'
			? [...library].sort(
					(a, b) => durationSeconds(a.workout) - durationSeconds(b.workout),
				)
			: byFocus(active),
	);
</script>

<main class="page max-w-4xl">
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
			<h2 class="eyebrow">your workouts</h2>
			<a href="/workouts/edit" class="hover:text-ink text-xs underline"
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
						class="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
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
							class="text-muted hover:text-ink ml-auto text-xs">Edit</a
						>
						<button
							onclick={() => {
								// Undo over confirm (errors.md): delete now, offer the way back.
								const workout = $state.snapshot(entry.workout) as Workout;
								void custom.remove(entry.id).then((err) => {
									if (err) toasts.push(err, { tone: 'error' });
									else
										toasts.push(`Deleted “${workout.name}”.`, {
											undo: () => void custom.save(workout),
										});
								});
							}}
							class="text-muted hover:text-ink text-xs">Delete</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<h2 class="eyebrow mt-8">curated</h2>
	{#if suggestion && suggested.length > 0}
		<p class="text-muted mt-2 text-xs">
			Suggested for today:
			<span class="text-ink font-semibold">{suggested.join(' / ')}</span>
			— {suggestion.why}. Your call, always.
		</p>
	{/if}
	<div class="mt-6 flex flex-wrap gap-1">
		{#each ['All', ...focuses] as option (option)}
			<button
				onclick={() => (active = option as Focus | 'All')}
				class="rounded px-3 py-1.5 text-xs {active === option
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{option}</button
			>
		{/each}
	</div>

	<ul class="mt-4 grid gap-3">
		{#each shown as entry (entry.id)}
			<li class="panel hover:border-muted/40 overflow-hidden transition-colors">
				<!-- Not one big anchor: the card carries two actions, and nesting them
				     inside a link is invalid and unreachable by keyboard. -->
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
					<a
						href="/ride?w={entry.id}"
						class="font-display font-bold hover:underline"
						>{entry.workout.name}</a
					>
					<span class="eyebrow">{entry.focus}</span>
					{#if suggestion && suggested.includes(entry.focus)}
						<span class="eyebrow text-z4" title={suggestion.why}
							>suggested today</span
						>
					{/if}
					<span class="text-muted ml-auto font-mono text-xs tabular-nums"
						>{formatClock(durationSeconds(entry.workout))}</span
					>
					<a
						href="/workouts/edit?from={entry.id}"
						class="text-muted hover:text-ink text-xs">Save a copy</a
					>
					<!-- The primary action, visible (#126): the title-only link read
					     as a label, and the rest of the card was dead surface. -->
					<a
						href="/ride?w={entry.id}"
						class="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-1 text-xs font-semibold"
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
