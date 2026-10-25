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
	 *
	 * A phone (below ADR-0020's md) is neither: one column of full-width
	 * panels in the slot order, the page scrolling down only, and the world —
	 * where it draws — a band in slot 2's place with nothing over it (#3676,
	 * v2-phone's riding screen).
	 */
	import type { Snippet } from 'svelte';
	import { device } from '$lib/device.svelte';
	import { createMoments } from '$lib/moments';
	import SummitStrip from '$lib/ride/SummitStrip.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { COLUMN_SEAT, offerSeat } from '$lib/channel/stage-slot.svelte';
	import {
		CORRIDOR,
		GAP_PX,
		INSET_PX,
		BAND_MAX_PX,
		JUKEBOX_SEAT,
		PHONE_WORLD_PX,
		SIDE_MAX,
		SKYLINE_PX,
		STAGE,
		STRIP_PX,
		momentAt,
		place,
	} from './docks';

	let {
		header,
		own = false,
		headerFit = false,
		focus,
		numbers,
		crew,
		horizon,
		world,
		moment,
		centre,
		dockIn = false,
		seat,
		stage = false,
		clean = false,
		onshow,
		cleanLine,
		class: extra = '',
	}: {
		header: Snippet;
		/** The caller draws its own panels in the header and focus slots, flat (the free ride's, #3893). */
		own?: boolean;
		/**
		 * Flat, slot 1 is its content's size: nothing in it stretches once the
		 * horizon's graph is the workout's picture and the strip is gone (#4159).
		 */
		headerFit?: boolean;
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
		/** The count-in is on: the slots fly to their docks through the moments queue (#3087). */
		dockIn?: boolean;
		/**
		 * A session's jukebox seat, offered to the player while the people
		 * column is folded away (#3668), with the now-playing line under it.
		 */
		seat?: Snippet;
		/** A shared screen has the focus: it takes the stage, the horizon a strip. */
		stage?: boolean;
		/** Clean view (#3216): over the world, only your numbers, the road and the Skyline. */
		clean?: boolean;
		/** Clean view's way back: one chip, so a hidden control keeps a hint (ADR-0062). */
		onshow?: () => void;
		/** Slot 1's road line, which Clean view keeps beside the chip. */
		cleanLine?: string;
		class?: string;
	} = $props();

	// The dock-in is a queued moment: cue the count-in's first frame, hit when
	// its `enter` ends. Reduced motion never stages it: the slots stand held.
	let docking = $state(false);
	$effect(() => {
		if (!dockIn || !world || prefersReducedMotion.current) return;
		const queue = createMoments({ now: () => performance.now() });
		queue.stage({ kind: 'dockin', payload: null });
		const step = () => {
			for (const e of queue.tick())
				if (e.kind === 'dockin') docking = e.stage === 'enter';
		};
		step();
		const id = setInterval(step, 50);
		return () => {
			clearInterval(id);
			docking = false;
		};
	});
	const dock = (i: number, x: string, y: string) =>
		docking ? `--dock-i:${i};--dock-x:${x};--dock-y:${y};` : '';
	const dockClass = $derived(docking ? 'dock-in' : '');

	// What slot 1 leaves free decides where the moment card goes (D12): a
	// measured fit, not a breakpoint (Jan, 2026-10-06).
	let width = $state(0);
	let slotWidth = $state(0);
	let playingH = $state(0);
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

{#if device.narrow}
	<!-- Phone: the flat slots in one column the page scrolls, at one gap
	     (TARGETS phone-ride 1). -->
	<!-- The last panel clears the floating navigation button (44 px and its inset). -->
	<div class="flex flex-col gap-3 pb-[4rem] {extra}" data-surface="phone">
		<div data-dock="header" class={own ? '' : 'ride-panel'}>
			{@render header()}
		</div>
		{#if world}
			<div
				data-dock="world"
				class="relative shrink-0 overflow-hidden rounded-lg"
				style="height:{PHONE_WORLD_PX}px"
			>
				{@render world()}
			</div>
		{/if}
		<div
			data-dock="focus"
			class="{own ? '' : 'ride-panel'} [&:not(:has(*))]:hidden"
		>
			{@render focus()}
		</div>
		{#if numbers}
			<div data-dock="numbers" class="ride-panel [&:not(:has(*))]:hidden">
				{@render numbers()}
			</div>
		{/if}
		{#if crew}
			<div data-dock="crew" class="ride-panel [&:not(:has(*))]:hidden">
				{@render crew()}
			</div>
		{/if}
		<SummitStrip />
		{#if horizon}
			<div
				data-dock="horizon"
				class="ride-panel flex flex-col overflow-hidden [&:not(:has(*))]:hidden"
			>
				{@render horizon()}
			</div>
		{/if}
	</div>
{:else if world}
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
				class="absolute grid items-start justify-items-center pt-[9%]"
				style={place(CORRIDOR)}
			>
				{@render centre()}
			</div>
		{/if}
		{#if clean}
			<div
				class="ride-panel ride-word absolute flex items-center gap-4 px-4"
				style="left:{INSET_PX}px;top:{INSET_PX}px"
			>
				<button
					data-testid="clean-exit"
					class="text-ink min-h-11 font-semibold"
					onclick={onshow}>Show panels · H</button
				>
				{#if cleanLine}<span class="num text-muted">{cleanLine}</span>{/if}
			</div>
		{:else}
			<div
				data-dock="header"
				class="{panel} {dockClass}"
				style="{dock(
					0,
					'0',
					'-40px',
				)}left:{INSET_PX}px;top:{INSET_PX}px;width:fit-content;max-width:min({BAND_MAX_PX}px, calc({seatLeft} - {INSET_PX +
					GAP_PX}px))"
				bind:offsetWidth={slotWidth}
			>
				{@render header()}
			</div>
		{/if}
		{#if !clean && moment && momentPlace === 'top'}
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
		{#if seat && !clean}
			<!-- The hole the player flies to: nothing is drawn over it (RMF). -->
			<div
				data-seat="jukebox"
				class="absolute"
				style="right:{INSET_PX}px;top:{INSET_PX}px;width:{seatW};height:{seatH}"
				{@attach (node) => offerSeat(node, COLUMN_SEAT)}
			></div>
			<!-- The now-playing line, directly under the seat at its width. -->
			<div
				data-testid="now-playing"
				class="absolute [&:not(:has(*))]:hidden"
				style="right:{INSET_PX}px;top:{underSeat};width:{seatW}"
				bind:offsetHeight={playingH}
			>
				{@render seat()}
			</div>
		{/if}
		<!-- The right column under the seat and any now-playing line: the
		     moment card when it does not fit top-centre, what has the focus,
		     then the crew. -->
		{#if !clean}
			<div
				class="absolute flex flex-col items-end gap-3"
				style="right:{INSET_PX}px;top:calc({underSeat} + {playingH
					? playingH + GAP_PX
					: 0}px);{side};bottom:{INSET_PX + SKYLINE_PX + GAP_PX}px"
			>
				{#if moment && momentPlace === 'seat'}
					<!-- Never wider than the column, so never into the corridor (G3). -->
					<div data-dock="moment" class="ride-panel max-w-full">
						{@render moment()}
					</div>
				{/if}
				{#if !stage}
					<div
						data-dock="focus"
						class="ride-panel [&:not(:has(*))]:hidden {dockClass}"
						style={dock(1, '40px', '0')}
					>
						{@render focus()}
					</div>
				{/if}
				{#if crew}
					<div
						data-dock="crew"
						class="ride-panel [&:not(:has(*))]:hidden {dockClass}"
						style={dock(2, '40px', '0')}
					>
						{@render crew()}
					</div>
				{/if}
			</div>
		{/if}
		{#if stage && !clean}
			<div data-dock="focus" class="{panel} grid" style={place(STAGE)}>
				{@render focus()}
			</div>
		{/if}
		{#if numbers}
			<!-- Your numbers stand on the Skyline at the left edge. -->
			<div
				data-dock="numbers"
				class="{panel} {dockClass} w-fit"
				style="{dock(3, '-40px', '0')}left:{INSET_PX}px;bottom:{INSET_PX +
					(stage ? STRIP_PX : SKYLINE_PX) +
					GAP_PX}px;{side}"
			>
				{@render numbers()}
			</div>
		{/if}
		<div
			class="absolute right-0 left-0 z-10 flex justify-center"
			style="bottom:{INSET_PX + (stage ? STRIP_PX : SKYLINE_PX) + GAP_PX}px"
		>
			<SummitStrip />
		</div>
		{#if horizon}
			<div
				data-dock="horizon"
				class="{panel} {dockClass} overflow-hidden"
				style="{dock(
					4,
					'0',
					'40px',
				)}left:{INSET_PX}px;right:{INSET_PX}px;bottom:{INSET_PX}px;height:{stage
					? STRIP_PX
					: SKYLINE_PX}px"
			>
				{@render horizon()}
			</div>
		{/if}
	</div>
{:else}
	<!-- No world: the same slots as flat panels in one column (#3670, TARGETS
	     ride-workout-flat). Panels touch at one gap, so no band opens between
	     them: the horizon takes the free height, or the focus does when a
	     screen has the stage or the caller draws its own (the free ride pins
	     its Skyline at the focus's foot, #4088). -->
	<div class="flex min-h-0 flex-col gap-3 {extra}" data-surface="flat">
		<div
			data-dock="header"
			class="shrink-0 {own ? '' : 'ride-panel'} {headerFit
				? 'max-w-full self-start'
				: ''}"
		>
			{@render header()}
		</div>
		<div
			data-dock="focus"
			class="{own
				? ''
				: 'ride-panel'} min-h-0 overflow-y-auto [&:not(:has(*))]:hidden {own
				? 'flex grow flex-col'
				: stage
					? 'grow'
					: 'shrink-0'}"
		>
			{@render focus()}
		</div>
		<!-- Your numbers and the crew share one row, each panel its content's
		     size (G3, #4159), as v2-ride's Flat road inset sets them side by
		     side; a column too narrow for both wraps the crew under the numbers.
		     gap-4 on the ride's spacing is the column's 12 px. -->
		<div
			class="flex shrink-0 flex-wrap items-start gap-4 [&:not(:has([data-dock]>*))]:hidden"
		>
			{#if numbers}
				<!-- One row at content height (TARGETS ride-workout-flat 8): the page
				     control on its own header line, then the head and the fields packed
				     left and the trim at the right end. The lines of their own are
				     sized out of the row's width (w-0, the gap given back), so the
				     panel ends at the trim. The computer is `contents` here, so its
				     full-panel page button spans this whole dock: the trim and
				     anything else beside it sit above that button (#4155). -->
				<div
					data-dock="numbers"
					class="ride-panel relative flex max-w-full flex-row flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 [&_[data-testid=bike-computer]]:contents [&_[data-testid=computer-fields]]:flex [&_[data-testid=computer-fields]]:flex-wrap [&_[data-testid=computer-fields]]:gap-x-8 [&_[data-testid=computer-fields]]:gap-y-3 [&_[data-testid=computer-fields]]:border-t-0 [&_[data-testid=computer-fields]]:pt-0 [&_[data-testid=computer-head]]:w-72 [&_[data-testid=computer-head]]:min-w-max [&_[data-testid=computer-head]>div:first-child]:justify-start [&_[data-testid=computer-head]>div:first-child]:gap-x-8 [&_[data-testid=computer-page-row]]:-mr-6 [&_[data-testid=computer-page-row]]:w-0 [&_[data-testid=computer-page-row]]:min-w-full [&_[data-testid=computer-page-row]]:basis-full [&_[data-testid=zone-strip]]:-mr-6 [&_[data-testid=zone-strip]]:w-0 [&_[data-testid=zone-strip]]:min-w-full [&_[data-testid=zone-strip]]:basis-full [&:not(:has(*))]:hidden [&>div]:relative [&>div]:z-10 [&>div]:ml-auto [&>div]:p-0"
				>
					{@render numbers()}
				</div>
			{/if}
			{#if crew}
				<div
					data-dock="crew"
					class="ride-panel max-w-full min-w-0 [&:not(:has(*))]:hidden"
				>
					{@render crew()}
				</div>
			{/if}
		</div>
		<SummitStrip />
		{#if horizon}
			<div
				data-dock="horizon"
				class="ride-panel flex min-h-28 flex-col overflow-hidden [&:not(:has(*))]:hidden {stage
					? 'shrink-0'
					: 'grow'}"
			>
				{@render horizon()}
			</div>
		{/if}
	</div>
{/if}
