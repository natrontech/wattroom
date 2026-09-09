<script lang="ts">
	import RoomStatus from '$lib/room/RoomStatus.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import TvMode from '$lib/room/TvMode.svelte';
	import type { SprintState } from '$lib/protocol';
	import { TV_SEAT, offerSeat } from '$lib/room/stage-slot.svelte';
	import type { Block, RoomRider } from '$lib/room/view';
	import type { Segment } from '$lib/workout/types';

	// TV mode's frame (#460, #686): the fullscreen surface, the way out of it,
	// and the seat the jukebox dock flies to while it is up. `TvMode` itself
	// draws the numbers and knows nothing about seats.
	//
	// Lifted out of RoomShell with the seat offer, which is the point of the
	// split: the geometry channel is one of the seams that file was tangling
	// together, and a seat offered from a component that also owns the sheet,
	// the stage and the panel is a seat nobody can reason about.

	let {
		riders,
		segments,
		total = 0,
		elapsed = 0,
		block,
		roomName,
		code = '',
		live = false,
		workoutName = '',
		playing = false,
		sprint = null,
		onExit,
	}: {
		riders: RoomRider[];
		segments: Segment[];
		total?: number;
		elapsed?: number;
		block: Block | null;
		roomName: string;
		code?: string;
		/** The session is running — TvMode draws live numbers rather than a lounge. */
		live?: boolean;
		workoutName?: string;
		/** Something is on the deck, so the dock needs somewhere to land. */
		playing?: boolean;
		/** The armed sprint, drawn over the numbers — the TV had none. */
		sprint?: SprintState | null;
		onExit: () => void;
	} = $props();

	const you = $derived(riders.find((r) => r.you));
</script>

<!-- TV mode is the cave whatever the theme says — it exists for the ride. -->
<div class="cave bg-surface fixed inset-0 z-50">
	{#if playing}
		<!-- The player takes the TV's top-right corner (#460): the dock
		     outranks this overlay and used to land wherever it was, over the
		     numbers. A seat here makes it part of the layout — ≥200×200 for
		     RMF, and it outranks the column's and the stage's seats. -->
		<div
			class="absolute top-[3vh] right-[3vw] z-10 aspect-video w-[24vw] min-w-[240px]"
			style="min-height: 200px"
			{@attach (node) => offerSeat(node, TV_SEAT)}
		></div>
	{/if}
	<!-- Ride-critical status on the TV too (audit 2026-09-09): the overlay
	     used to paint over a trainer drop, a reconnect and the rider's own
	     auto-pause while the instrument kept looking confident. Clear of
	     the player's seat in the top-right. -->
	<div class="absolute top-[2vh] right-[30vw] left-[3vw] z-10">
		<RoomStatus />
	</div>
	{#if sprint}
		<div class="absolute inset-x-[12vw] top-[14vh] z-10">
			<SprintMoment {sprint} myWatts={you?.watts ?? 0} roster={riders} />
		</div>
	{/if}
	<button
		onclick={onExit}
		class="border-muted/30 text-muted hover:text-ink absolute bottom-4 left-4 z-10 rounded border px-3 py-1.5 text-xs"
		>Exit TV mode (esc)</button
	>
	<TvMode
		{riders}
		{segments}
		{total}
		{elapsed}
		{block}
		{roomName}
		{code}
		{live}
		{workoutName}
	/>
</div>
