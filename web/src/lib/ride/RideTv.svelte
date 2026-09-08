<script lang="ts">
	/**
	 * Solo TV (#126, #1057): the same truth at three-metre size, vh-scaled the
	 * way the room's TV mode is.
	 *
	 * The last of the ride screen's four surfaces to get its own file. It is
	 * the only one that is a full-screen overlay rather than part of the page's
	 * column, which is why it reads as a separate thing even though it draws
	 * numbers the riding screen already has.
	 */
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { ZONE_TEXT } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import type { createRideSession } from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';

	let {
		session,
		workout,
		ftp,
		remaining,
		watts,
		target,
		zone,
		onExit,
	}: {
		session: ReturnType<typeof createRideSession>;
		workout: Workout;
		ftp: number;
		remaining: number;
		watts: number;
		target: number;
		/** The power zone this effort is in, for the one coloured word. */
		zone: keyof typeof ZONE_TEXT;
		onExit: () => void;
	} = $props();
</script>

<div class="bg-surface fixed inset-0 z-50 flex flex-col px-[3vw] py-[3vh]">
	<button
		onclick={onExit}
		class="border-muted/30 text-muted hover:text-ink absolute bottom-4 left-4 rounded border px-3 py-1.5 text-xs"
		>Exit TV (esc)</button
	>
	<header class="flex items-baseline gap-[2vw]">
		<h2 class="font-display text-[3.2vh] leading-none font-bold">
			{workout.name}
		</h2>
		<span
			class="font-display ml-auto text-[6vh] leading-none font-bold tabular-nums"
			>{formatClock(remaining)}</span
		>
	</header>
	<div class="flex flex-1 flex-col items-center justify-center">
		<div>
			<span
				class="text-watt glow-text-strong font-display text-[18vh] leading-none font-bold tabular-nums"
				>{watts}</span
			>
			<span class="text-muted ml-2 text-[3vh]">W</span>
		</div>
		<div class="text-muted mt-[2vh] flex items-baseline gap-[2vw] text-[3vh]">
			<span>{target > 0 ? `target ${target} W` : 'no target'}</span>
			<span class="font-display font-bold {ZONE_TEXT[zone]}">Z{zone}</span>
		</div>
	</div>
	<div class="overflow-hidden rounded-lg">
		<IntervalGraph
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			{ftp}
			trace={session.trace}
		/>
	</div>
</div>
