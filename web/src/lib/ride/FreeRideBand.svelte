<script lang="ts">
	/**
	 * Slot 1 of a free ride (TARGETS ride-free-road 3 and 7, #3669): the
	 * road ride's, a voice channel's, and a ride whose workout was taken off
	 * on its road (#4283). The callers own what rides; this draws the rows.
	 *
	 * Four rows, so the road's name is never cut for the controls: the label
	 * with the caller's own controls, the road line, the chip row, then the
	 * ride's controls, 176 px at SPEC's sizes, above the corridor (the box
	 * table's 200). `more` is a fifth.
	 */
	import type { Snippet } from 'svelte';
	import { formatClock } from '$lib/format';

	let {
		label,
		roadLine,
		chip,
		seconds,
		climbed,
		status,
		controls,
		notes,
		actions,
		more,
	}: {
		/** "Free ride · <road>" (freeRideLabel). */
		label: string;
		/** Where on the road, once (TARGETS one home: slot 1's road line); off a road, none. */
		roadLine?: string;
		/** How the trainer rides it, once (TARGETS one home). */
		chip?: string;
		/** The ride's time. */
		seconds: number;
		/** Metres climbed this ride, on a road. */
		climbed?: number;
		/**
		 * The ride's status line, in the label's place while one holds (G3);
		 * a ride-critical one, an alert, takes the chip row's too.
		 */
		status?: Snippet;
		/** The caller's own controls, on the label's row. */
		controls?: Snippet;
		/** The rest of the chip row: a ramp, the ⚑'s notice. */
		notes?: Snippet;
		/** The ride's controls. */
		actions: Snippet;
		/** A row under the controls. */
		more?: Snippet;
	} = $props();

	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
</script>

<header
	data-testid="ride-band"
	class="group/band flex flex-col gap-2 px-4 py-2"
>
	<div class="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
		<!-- The status draws its line only while one holds; the label steps
		     aside for it. -->
		<div class="group/status min-w-0 flex-1">
			{@render status?.()}
			<p
				data-testid="ride-context"
				class="ride-label min-w-0 truncate group-has-[[data-status-line]]/status:hidden"
			>
				{label}
			</p>
		</div>
		{#if controls}
			<div class="flex flex-wrap items-center gap-2">
				{@render controls()}
			</div>
		{/if}
	</div>
	{#if roadLine}
		<!-- Where on the road, once (TARGETS one home: slot 1's road line). -->
		<p
			data-testid="block-road"
			class="num text-4xl leading-none font-bold max-md:text-2xl"
		>
			{roadLine}
		</p>
	{/if}
	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-1 {WORDS} group-has-[[data-status-line][role=alert]]/band:hidden"
	>
		{#if chip}<span data-testid="trainer-chip" class={CHIP}>{chip}</span>{/if}
		<p data-testid="ride-clock" class="num text-muted">
			{formatClock(
				seconds,
			)}{#if climbed !== undefined}{` · ${Math.round(climbed)} m climbed`}{/if}
		</p>
		{@render notes?.()}
	</div>
	<!-- One row of 44 px controls (ux.md, TARGETS ride-free-road 7); it
	     wraps rather than clipping, as every control row does (#1634). -->
	<div class="flex min-w-0 flex-wrap items-center gap-2">
		{@render actions()}
	</div>
	{@render more?.()}
</header>
