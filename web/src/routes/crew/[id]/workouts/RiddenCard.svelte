<script lang="ts">
	// One workout the crew rode together (#2583), in the shape of the
	// personal Workouts cards (#1525): the picture, then what the crew made
	// of it — its sessions, the time, the people who rode it — and the
	// sessions themselves behind a fold. Presence and time only (ADR-0034):
	// who and when, never anybody's numbers but your own, behind the recap.
	import type { Snippet } from 'svelte';
	import WorkoutPreview from '$lib/components/WorkoutPreview.svelte';
	import type { RiddenWorkout } from '$lib/crew-workouts';
	import { formatClock, formatDuration } from '$lib/format';
	import SessionRecapCard from '$lib/session/SessionRecapCard.svelte';
	import { segmentsDuration } from '$lib/workout/engine';
	import { parseSharedSegments } from '$lib/workout/shared';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let {
		workout,
		json,
		ftp,
		actions,
	}: {
		workout: RiddenWorkout;
		/** Its definition, when a plan or your shelf holds it — the graph. */
		json: string | null;
		ftp: number;
		/** Ride it again, and the plan form it opens: the page's. */
		actions: Snippet;
	} = $props();

	const segments = $derived(json ? parseSharedSegments(json) : []);
	let open = $state(false);

	// You first, then four names and a count: a crew of twelve all riding it
	// is a sentence, not a roster.
	const NAMES = 4;
	const names = $derived(
		[
			...(workout.yours
				? [workout.yours === 1 ? 'you' : `you ${workout.yours}×`]
				: []),
			...workout.riders.slice(0, NAMES),
		].join(', ') +
			(workout.riders.length > NAMES
				? ` +${workout.riders.length - NAMES}`
				: ''),
	);
	const last = $derived(
		new Date(workout.lastAt).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		}),
	);
</script>

<li class="panel panel-flush flex flex-col overflow-hidden">
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
		<button
			onclick={() => (open = !open)}
			aria-expanded={open}
			class="font-display text-left font-bold hover:underline"
			>{workout.name}</button
		>
		{#if segments.length}
			<span class="text-muted ml-auto font-mono text-xs tabular-nums"
				>{formatClock(segmentsDuration(segments))}</span
			>
		{/if}
	</div>
	<p class="text-muted px-5 pt-1 text-xs tabular-nums">
		{workout.times === 1 ? 'Once' : `${workout.times} sessions`} · {formatDuration(
			workout.seconds,
		)} together · last {last}
	</p>
	{#if names}
		<p class="truncate px-5 pt-1 text-xs" title={workout.riders.join(', ')}>
			<span class="text-muted">Rode it:</span>
			{names}
		</p>
	{/if}

	<div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-3">
		{@render actions()}
		<button
			onclick={() => (open = !open)}
			aria-expanded={open}
			class="text-muted hover:text-ink ml-auto flex items-center gap-1 text-xs"
			>{open ? 'Hide' : 'Show'} its sessions<ChevronDown
				size={13}
				class="transition-transform motion-reduce:transition-none {open
					? 'rotate-180'
					: ''}"
			/></button
		>
	</div>

	{#if open}
		<ul class="grid gap-2 px-5 pt-3" aria-label="sessions of {workout.name}">
			{#each workout.recaps as recap (recap.id)}
				<li><SessionRecapCard {recap} /></li>
			{/each}
		</ul>
	{/if}

	{#if segments.length}
		<WorkoutPreview
			{segments}
			{ftp}
			compact
			names={false}
			legendClass="px-5 pt-2 pb-1.5"
		/>
	{:else}
		<p class="text-muted px-5 pt-3 pb-4 text-xs">
			Not on your shelf or the schedule — whoever coached it built it.
		</p>
	{/if}
</li>
