<script lang="ts">
	/**
	 * The riding surface (ADR-0046, #3081): one layout for a session's
	 * Training place and a solo ride, slot by slot — the header (1), what has
	 * the focus (2), your numbers (3), the crew (4) and the horizon (5), with a
	 * ride's status line between the header and the focus. Each slot keeps its
	 * own row whether or not it draws anything, so the focus always takes the
	 * free height; what fills a slot, and its padding, is the caller's.
	 *
	 * With a world (#3031, ADR-0066) the world fills the surface edge to edge
	 * and each slot is one flat `ride-panel`, its content's size, anchored
	 * clear of the road ahead (docks.ts, #3668): slot 1 top left — the status,
	 * when one holds, is its own first line — your numbers on the Skyline at
	 * the left edge, the crew and what has the focus under the jukebox seat,
	 * and the moment card top-centre when it fits there, otherwise under the
	 * seat (D12). A shared screen takes the stage while the world holds.
	 */
	import type { Snippet } from 'svelte';
	import { COLUMN_SEAT, offerSeat } from '$lib/channel/stage-slot.svelte';
	import {
		CORRIDOR,
		GAP_PX,
		INSET_PX,
		JUKEBOX_SEAT,
		SIDE_MAX,
		SKYLINE_PX,
		STAGE,
		STRIP_PX,
		momentAt,
		place,
	} from './docks';

	let {
		header,
		status,
		focus,
		numbers,
		crew,
		horizon,
		world,
		moment,
		centre,
		seat,
		stage = false,
		class: extra = '',
	}: {
		header: Snippet;
		/** The flat layout's status row; over the world it is slot 1's first line, the caller's. */
		status?: Snippet;
		focus: Snippet;
		numbers?: Snippet;
		crew?: Snippet;
		horizon?: Snippet;
		/** The world, drawn behind the docks. */
		world?: Snippet;
		/** A moment card — a sprint armed or live (D12) — over the world. */
		moment?: Snippet;
		/** The one thing the corridor holds: the count-in's digit (TARGETS ride-countin 2). */
		centre?: Snippet;
		/**
		 * A session's jukebox seat, offered to the player while the people
		 * column is folded away (#3668), with the now-playing line under it.
		 */
		seat?: Snippet;
		/** A shared screen has the focus: it takes the stage, the horizon a strip. */
		stage?: boolean;
		class?: string;
	} = $props();

	// What slot 1 leaves free decides where the moment card goes (D12): a
	// measured fit, not a breakpoint (Jan, 2026-10-06).
	let width = $state(0);
	let slotWidth = $state(0);
	const momentPlace = $derived(momentAt(width, INSET_PX + slotWidth));
	const seatLeft = `${JUKEBOX_SEAT.x0 * 100}%`;
	const seatW = `${(JUKEBOX_SEAT.x1 - JUKEBOX_SEAT.x0) * 100}%`;
	const seatH = `${(JUKEBOX_SEAT.y1 - JUKEBOX_SEAT.y0) * 100}%`;
	// The right column hangs under the seat, empty or not: on a solo ride
	// nothing grows into it (TARGETS ride-road-world 14).
	const underSeat = `calc(${INSET_PX}px + ${seatH} + ${GAP_PX}px)`;
	const side = `max-width:calc(${SIDE_MAX * 100}% - ${INSET_PX}px)`;
	// A dock with nothing drawn in it (anchors and whitespace only) is not drawn either.
	const panel = 'ride-panel absolute [&:not(:has(*))]:hidden';
</script>

{#if world}
	<div
		class="relative min-h-0 overflow-hidden {extra}"
		data-surface="docked"
		bind:clientWidth={width}
	>
		<div class="absolute inset-0">{@render world()}</div>
		{#if centre}
			<!-- In the corridor's upper half, above where the chase camera
			     draws you (RIDER_BOX), as v3-motion's GO stands. -->
			<div
				class="absolute grid items-start justify-items-center pt-[6%]"
				style={place(CORRIDOR)}
			>
				{@render centre()}
			</div>
		{/if}
		<div
			data-dock="header"
			class="{panel} w-fit"
			style="left:{INSET_PX}px;top:{INSET_PX}px;max-width:calc({seatLeft} - {INSET_PX +
				GAP_PX}px)"
			bind:offsetWidth={slotWidth}
		>
			{@render header()}
		</div>
		{#if moment && momentPlace === 'top'}
			<!-- Top-centre, in what slot 1 leaves before the seat. -->
			<div
				class="absolute flex justify-center"
				style="left:{INSET_PX +
					slotWidth +
					GAP_PX}px;right:calc(100% - {seatLeft} + {GAP_PX}px);top:{INSET_PX}px"
			>
				<div data-dock="moment" class="ride-panel">{@render moment()}</div>
			</div>
		{/if}
		{#if seat}
			<!-- The hole the player flies to: nothing is drawn over it (RMF). -->
			<div
				data-seat="jukebox"
				class="absolute"
				style="right:{INSET_PX}px;top:{INSET_PX}px;width:{seatW};height:{seatH}"
				{@attach (node) => offerSeat(node, COLUMN_SEAT)}
			></div>
		{/if}
		<!-- The right column under the seat: the now-playing line at the seat's
		     width, the moment card when it does not fit top-centre, what has the
		     focus, then the crew. -->
		<div
			class="absolute flex flex-col items-end gap-3"
			style="right:{INSET_PX}px;top:{underSeat};{side};bottom:{INSET_PX +
				SKYLINE_PX +
				GAP_PX}px"
		>
			{#if seat}<div
					style="width:{width * (JUKEBOX_SEAT.x1 - JUKEBOX_SEAT.x0)}px"
					class="max-w-full [&:not(:has(*))]:hidden"
				>
					{@render seat()}
				</div>{/if}
			{#if moment && momentPlace === 'seat'}
				<!-- Never wider than the column, so never into the corridor (G3). -->
				<div data-dock="moment" class="ride-panel max-w-full">
					{@render moment()}
				</div>
			{/if}
			{#if !stage}
				<div data-dock="focus" class="ride-panel [&:not(:has(*))]:hidden">
					{@render focus()}
				</div>
			{/if}
			{#if crew}
				<div data-dock="crew" class="ride-panel [&:not(:has(*))]:hidden">
					{@render crew()}
				</div>
			{/if}
		</div>
		{#if stage}
			<div data-dock="focus" class="{panel} grid" style={place(STAGE)}>
				{@render focus()}
			</div>
		{/if}
		{#if numbers}
			<!-- Your numbers stand on the Skyline at the left edge. -->
			<div
				data-dock="numbers"
				class="{panel} w-fit"
				style="left:{INSET_PX}px;bottom:{INSET_PX +
					(stage ? STRIP_PX : SKYLINE_PX) +
					GAP_PX}px;{side}"
			>
				{@render numbers()}
			</div>
		{/if}
		{#if horizon}
			<div
				data-dock="horizon"
				class="{panel} overflow-hidden"
				style="left:{INSET_PX}px;right:{INSET_PX}px;bottom:{INSET_PX}px;height:{stage
					? STRIP_PX
					: SKYLINE_PX}px"
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
