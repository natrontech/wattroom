<script lang="ts">
	import { rideClick } from '#lib/nav/ask-ride.ts';
	/**
	 * Today's ride from the rider's own plan (#4615): the workout they or
	 * their coach put on today, one big press from riding it. Absent when
	 * nothing is planned, so Home leads with its doors as before.
	 */
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Play from '@lucide/svelte/icons/play';
	import { localDay, myPlan } from '#lib/workout/plan.svelte.ts';

	const plan = myPlan();
	void plan.fresh();
	const today = $derived(plan.on(localDay(new Date())));
</script>

{#if today.length > 0}
	<section class="panel flex flex-col gap-2" data-testid="today-ride">
		<p class="eyebrow flex items-center gap-1.5">
			<CalendarCheck size={12} /> today's ride
		</p>
		{#each today as ride (ride.id)}
			<div class="flex flex-wrap items-center gap-3">
				<p class="font-display min-w-0 flex-1 truncate text-lg font-bold">
					{ride.workoutName}
				</p>
				<a
					href="/ride?w={ride.workoutId}"
					onclick={(e) => rideClick(e, { pick: ride.workoutId })}
					class="btn btn-primary btn-lg"><Play size={15} /> Ride it</a
				>
			</div>
		{/each}
	</section>
{/if}
