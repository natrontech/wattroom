<script lang="ts">
	/**
	 * The riding surface (ADR-0046, #3081): one layout for a session's
	 * Training place and a solo ride, slot by slot — the header (1), what has
	 * the focus (2), your numbers (3), the crew (4) and the horizon (5), with a
	 * ride's status line between the header and the focus. Each slot keeps its
	 * own row whether or not it draws anything, so the focus always takes the
	 * free height; what fills a slot, and its padding, is the caller's.
	 *
	 * With a world (#3031, ADR-0066) the world fills the surface and the slots
	 * dock around it (docks.ts), clear of the road ahead; what has the focus —
	 * a sprint, a game — floats in its dock, and a shared screen takes the
	 * stage while the world holds.
	 */
	import type { Snippet } from 'svelte';
	import { DOCKS, STAGE, STRIP_PX, place, type Layout } from './docks';

	let {
		header,
		status,
		focus,
		numbers,
		crew,
		horizon,
		world,
		layout = 'desk',
		stage = false,
		class: extra = '',
	}: {
		header: Snippet;
		status?: Snippet;
		focus: Snippet;
		numbers?: Snippet;
		crew?: Snippet;
		horizon?: Snippet;
		/** The world, drawn behind the docks. */
		world?: Snippet;
		layout?: Layout;
		/** A shared screen has the focus: it takes the stage, the horizon a strip. */
		stage?: boolean;
		class?: string;
	} = $props();

	const docks = $derived(DOCKS[layout]);
	// A dock with nothing drawn in it (anchors and whitespace only) is not drawn either.
	const dock =
		'bg-surface/80 absolute overflow-auto rounded-xl [&:not(:has(*))]:hidden';
</script>

{#if world}
	<div class="relative min-h-0 overflow-hidden {extra}" data-surface="docked">
		<div class="absolute inset-0">{@render world()}</div>
		<div data-dock="header" class={dock} style={place(docks.header)}>
			{@render header()}
		</div>
		{#if status}
			<div data-dock="status" class={dock} style={place(docks.status)}>
				{@render status()}
			</div>
		{/if}
		<div
			data-dock="focus"
			class="{dock} grid"
			style={place(stage ? STAGE : docks.focus)}
		>
			{@render focus()}
		</div>
		{#if numbers}
			<div data-dock="numbers" class={dock} style={place(docks.numbers)}>
				{@render numbers()}
			</div>
		{/if}
		{#if crew}
			<div data-dock="crew" class={dock} style={place(docks.crew)}>
				{@render crew()}
			</div>
		{/if}
		{#if horizon}
			<div
				data-dock="horizon"
				class="{dock} overflow-hidden"
				style={stage
					? `left:2%;right:2%;bottom:2%;height:${STRIP_PX}px`
					: place(docks.horizon)}
			>
				{@render horizon()}
			</div>
		{/if}
	</div>
{:else}
	<div
		class="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto_auto_auto] {extra}"
	>
		<div class="row-start-1 min-w-0">{@render header()}</div>
		{#if status}<div class="row-start-2 min-w-0">{@render status()}</div>{/if}
		<!-- The focus fills its row: one stretched cell, allowed to shrink below its content. -->
		<div class="row-start-3 grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
			{@render focus()}
		</div>
		{#if numbers}<div class="row-start-4 min-w-0">{@render numbers()}</div>{/if}
		{#if crew}<div class="row-start-5 min-w-0">{@render crew()}</div>{/if}
		{#if horizon}<div class="row-start-6 min-w-0">{@render horizon()}</div>{/if}
	</div>
{/if}
