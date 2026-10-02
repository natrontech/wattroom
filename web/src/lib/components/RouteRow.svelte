<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import type { Snippet } from 'svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { classChips, riddenLine, statLine } from '$lib/road/route-row';
	import type { StoredRoute } from '$lib/road/stored';

	/**
	 * One route, the same row everywhere a rider's routes are listed (#3683):
	 * the Workouts shelf, /ride's road picker, a workout's “on a route” and the
	 * session picker. Its name opens the route page; on the shelf the whole
	 * card does, and the row's action sits at its bottom right.
	 */
	let {
		route,
		card = false,
		selected = false,
		extra,
		action,
		menu,
	}: {
		route: StoredRoute;
		/** The shelf's card: the whole of it opens the route page. */
		card?: boolean;
		/** Chosen in a picker: the neon border. */
		selected?: boolean;
		/** Appended to the stat line: a crew's time at its pace. */
		extra?: string;
		/** The row's own action, bottom right: Ride, Pick, Ride it. */
		action?: Snippet;
		/** The right-click and long-press menu, where the row has one. */
		menu?: () => MenuEntry[];
	} = $props();

	const chips = $derived(classChips(route.climbs));
	const attach = $derived(menu ? contextMenu(menu) : () => () => {});
</script>

<article
	class="relative flex flex-col gap-1 {card
		? 'panel panel-lg hover:border-neon/40'
		: 'rounded-lg border px-3 py-2'} {selected
		? 'border-neon'
		: card
			? ''
			: 'border-frame'}"
	title={menu ? MENU_HINT : undefined}
	{@attach attach}
>
	<div class="flex items-baseline gap-2">
		<a
			href="/workouts/routes/{route.id}"
			class="font-display min-w-0 flex-1 truncate text-base font-bold hover:underline {card
				? 'after:absolute after:inset-0'
				: ''}">{route.name}</a
		>
		{#if route.ownerOnly}
			<span
				class="border-frame text-muted inline-flex shrink-0 items-center gap-1 rounded border px-1.5 text-xs"
				><Lock size={11} /> Only you</span
			>
		{/if}
		{#each chips as cls, i (cls)}
			<span
				class="font-display shrink-0 rounded px-1.5 text-xs leading-5 font-bold {i ===
				0
					? 'bg-neon text-on-neon'
					: 'border-neon/60 border'}">{cls}</span
			>
		{/each}
	</div>
	<p class="text-muted num text-xs">
		{statLine(route)}{extra ? ` · ${extra}` : ''}
	</p>
	<div class="flex min-h-7 flex-wrap items-center gap-2">
		<p class="text-muted text-xs">{riddenLine(route)}</p>
		{#if action}
			<!-- Above the card's stretched link, so the action is its own. -->
			<div class="relative z-10 ml-auto flex items-center gap-2">
				{@render action()}
			</div>
		{/if}
	</div>
</article>
