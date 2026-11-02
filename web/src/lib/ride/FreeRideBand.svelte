<script lang="ts">
	/**
	 * Slot 1 of a free ride (TARGETS ride-free-road 3 and 7, #3669): the
	 * road ride's, a voice channel's, and a ride whose workout was taken off
	 * on its road (#4283). The callers own what rides; this draws the rows.
	 *
	 * Three rows: the label, the road line, the chip row. The ride's
	 * controls are the now bar's.
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
		notes,
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
		/** The rest of the chip row: a ramp, the ⚑'s notice. */
		notes?: Snippet;
	} = $props();

	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
</script>

<header
	data-testid="ride-band"
	class="group/band flex flex-col gap-2 px-4 py-2"
>
	<!-- The status draws its line only while one holds; the label steps
	     aside for it. -->
	<div class="group/status min-w-48">
		{@render status?.()}
		<p
			data-testid="ride-context"
			class="ride-label min-w-0 truncate group-has-[[data-status-line]]/status:hidden"
		>
			{label}
		</p>
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
</header>
