<script lang="ts">
	/**
	 * Slot 1 of a free ride (TARGETS ride-free-road 3 and 7, #3669): the
	 * road ride's, a voice channel's, and a ride whose workout was taken off
	 * on its road (#4283). The callers own what rides; this draws the rows.
	 *
	 * Three rows on a desk: the label with the ride's controls, as the box
	 * table's “eyebrow or status line 24 with the controls 44” and v2-ride's
	 * top right; the road line; the chip row. The road's name truncates at
	 * its end beside the controls, never under them. A caller with controls
	 * of its own (a voice channel's) keeps those beside the label and the
	 * ride's after the chip row: ten do not fit beside a name. A phone keeps
	 * the road line under the label and the ride's controls after the chip
	 * row (v2-phone). `more` comes last.
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
		/** A row under the chip row. */
		more?: Snippet;
	} = $props();

	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
</script>

{#snippet rideControls()}
	<!-- 44 px controls (ux.md, TARGETS ride-free-road 7); they wrap rather
	     than clipping, as every control row does (#1634). -->
	<div class="flex min-w-0 flex-wrap items-center gap-2 max-md:order-last">
		{@render actions()}
	</div>
{/snippet}

<header
	data-testid="ride-band"
	class="group/band flex flex-col gap-2 px-4 py-2"
>
	<!-- One line on a desk: the band's own width is then the label's and the
	     controls' side by side, where a wrapping row takes its widest item's.
	     On a phone its parts join the column. -->
	<div class="flex min-w-0 items-center gap-x-6 max-md:contents">
		<!-- The status draws its line only while one holds; the label steps
		     aside for it. -->
		<div class="group/status min-w-48 flex-1">
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
		{:else}
			{@render rideControls()}
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
	{#if controls}{@render rideControls()}{/if}
	{#if more}
		<div class="max-md:order-last [&:not(:has(*))]:hidden">
			{@render more()}
		</div>
	{/if}
</header>
