<script lang="ts">
	import type { Snippet } from 'svelte';
	import WorkoutPreview from '$lib/components/WorkoutPreview.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { formatClock } from '$lib/format';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type { Workout } from '$lib/workout/types';

	/**
	 * One card for every workout on the shelf, curated or your own (#1525): the
	 * verbs differ, the picture never does. Yours used to be a bare row with no
	 * graph at all, next to twenty-seven cards that had one.
	 */
	let {
		workout,
		href,
		ftp,
		focus,
		summary,
		menu,
		badge,
		actions,
	}: {
		workout: Workout;
		/** Where the title goes — the primary action, per ux.md. */
		href: string;
		ftp: number;
		focus?: string;
		summary?: string;
		menu: () => MenuEntry[];
		badge?: Snippet;
		actions: Snippet;
	} = $props();
</script>

<li
	class="panel hover:border-muted/40 flex flex-col overflow-hidden transition-colors"
	title={MENU_HINT}
	{@attach contextMenu(menu)}
>
	<!-- Not one big anchor: the card carries several actions, and nesting them
	     inside a link is invalid and unreachable by keyboard. -->
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
		<a {href} class="font-display font-bold hover:underline">{workout.name}</a>
		{#if focus}<span class="eyebrow">{focus}</span>{/if}
		{@render badge?.()}
		<span class="text-muted ml-auto font-mono text-xs tabular-nums"
			>{formatClock(durationSeconds(workout))}</span
		>
	</div>
	{#if summary}
		<p class="text-muted px-5 pt-1 text-xs">{summary}</p>
	{/if}
	<!-- mt-auto: the graph is the bottom of every card whatever the description
	     does above it, so a row of cards can be read across (#1525). -->
	<div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-3">
		{@render actions()}
	</div>
	<WorkoutPreview
		segments={flatten(workout)}
		{ftp}
		compact
		names={false}
		legendClass="px-5 pt-2 pb-1.5"
	/>
</li>
