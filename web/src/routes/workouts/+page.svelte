<script lang="ts">
	import { Copy, Gauge, Pencil, Play, Trash2 } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/format';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { byFocus, focuses, library, type Focus } from '$lib/workout/library';
	import {
		createCustomStore,
		type CustomWorkout,
	} from '$lib/workout/custom.svelte';
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

	// Undo over confirm (errors.md): delete now, offer the way back. Shared by
	// the card's Delete and its menu.
	function removeCustom(entry: CustomWorkout) {
		const workout = $state.snapshot(entry.workout) as Workout;
		void custom.remove(entry.id).then((err) => {
			if (err) toasts.push(err, { tone: 'error' });
			else
				toasts.push(`Deleted “${workout.name}”.`, {
					undo: () => void custom.save(workout),
				});
		});
	}

	// A card's verbs, as a menu (#486) — the same buttons the card carries.
	const rideItem = (id: string) => ({
		label: 'Ride',
		icon: Play,
		onSelect: () => void goto(`/ride?w=${id}`),
	});
	const libraryMenu = (id: string): MenuEntry[] => [
		rideItem(id),
		{
			label: 'Save a copy',
			icon: Copy,
			onSelect: () => void goto(`/workouts/edit?from=${id}`),
		},
	];
	const customMenu = (entry: CustomWorkout): MenuEntry[] => [
		rideItem(entry.id),
		{
			label: 'Edit',
			icon: Pencil,
			onSelect: () => void goto(`/workouts/edit?w=${entry.id}`),
		},
		'separator',
		{
			label: 'Delete',
			icon: Trash2,
			onSelect: () => removeCustom(entry),
			danger: true,
		},
	];
	const shown = $derived(
		active === 'All'
			? [...library].sort(
					(a, b) => durationSeconds(a.workout) - durationSeconds(b.workout),
				)
			: byFocus(active),
	);
</script>

<main class="page">
	<div class="flex items-center gap-3">
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
			<ul class="mt-2 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
				{#each custom.all as entry (entry.id)}
					<li
						class="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
						title={MENU_HINT}
						{@attach contextMenu(() => customMenu(entry))}
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
							onclick={() => removeCustom(entry)}
							class="text-muted hover:text-ink text-xs">Delete</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- /ramp retires here (ADR-0020): a ramp test is a workout you start, not
	     a destination. It keeps its own ride screen — it writes your FTP — but
	     it is reached from the shelf. -->
	<h2 class="eyebrow mt-8">measure</h2>
	<ul class="mt-3">
		<li class="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
			<Gauge size={16} class="text-muted shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="font-display truncate text-base font-bold">Ramp test</p>
				<p class="text-muted mt-0.5 text-xs">
					About 20 minutes. Sets your FTP, and suggests an LTHR from how it
					ended.
				</p>
			</div>
			<a href="/ramp" class="btn btn-accent btn-xs shrink-0">Start</a>
		</li>
	</ul>

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

	<ul class="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
		{#each shown as entry (entry.id)}
			<li
				class="panel hover:border-muted/40 overflow-hidden transition-colors"
				title={MENU_HINT}
				{@attach contextMenu(() => libraryMenu(entry.id))}
			>
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
