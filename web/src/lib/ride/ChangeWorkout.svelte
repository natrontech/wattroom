<script lang="ts">
	/**
	 * Change workout, mid-ride (#4257): another workout, or on a road none,
	 * picked with one big tap each. The ride, its recording and the place on
	 * the road carry on; the page starts the pick at its first block.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import { formatClock } from '$lib/format';
	import { FREE_RIDE_NAME } from '$lib/ride/free-ride.svelte';
	import { durationSeconds } from '$lib/workout/engine';
	import type { ShelfEntry } from '$lib/workout/shelf';
	import type { Workout } from '$lib/workout/types';

	let {
		shelf,
		current,
		onRoad,
		onpick,
		onclose,
	}: {
		shelf: ShelfEntry[];
		/** The workout under way, marked and not offered again. */
		current: string;
		/** On a road the ride may carry on with no workout. */
		onRoad: boolean;
		onpick: (next: Workout | null) => void;
		onclose: () => void;
	} = $props();

	const ROW =
		'btn btn-secondary btn-ride flex w-full items-center justify-between gap-3 text-left';
</script>

<Modal label="Change workout" {onclose} class="max-w-lg">
	<h2 class="font-display text-lg font-bold">Change workout</h2>
	<p class="text-muted mt-1 text-sm">
		The ride carries on from here. The new workout starts at its first block.
	</p>
	<ul
		class="mt-4 grid max-h-[60vh] gap-2 overflow-y-auto"
		aria-label="workouts"
	>
		{#if onRoad}
			<li>
				<button
					onclick={() => onpick(null)}
					disabled={current === FREE_RIDE_NAME}
					class={ROW}
				>
					<span class="min-w-0 truncate">No workout</span>
					<span class="text-muted shrink-0 text-xs">The road’s own grade</span>
				</button>
			</li>
		{/if}
		{#each shelf as entry (entry.id)}
			<li>
				<button
					onclick={() => onpick(entry.workout)}
					disabled={entry.workout.name === current}
					class={ROW}
				>
					<span class="min-w-0 truncate">{entry.workout.name}</span>
					<span class="text-muted num shrink-0 text-xs"
						>{entry.workout.name === current
							? 'Riding now'
							: formatClock(durationSeconds(entry.workout))}</span
					>
				</button>
			</li>
		{/each}
	</ul>
	<button onclick={onclose} class="btn btn-ghost btn-ride mt-4"
		>Keep riding</button
	>
</Modal>
