<script lang="ts">
	import { rideClick } from '#lib/nav/ask-ride.ts';
	/**
	 * The rider's own week (#4615): what they planned for themselves, today
	 * first, each day's workout one press from riding. Seen by them alone; a
	 * crew's sessions live on that crew's Schedule.
	 */
	import X from '@lucide/svelte/icons/x';
	import Banner from '#lib/components/Banner.svelte';
	import { toasts } from '#lib/toast.svelte.ts';
	import {
		dayLabel,
		myPlan,
		weekFrom,
		type PlannedRide,
	} from '#lib/workout/plan.svelte.ts';

	const plan = myPlan();
	void plan.fresh();
	const now = new Date();
	const days = weekFrom(now);
	const any = $derived(plan.rides.length > 0);

	// Reversible, so at once with an undo (AGENTS.md product rules).
	function unplan(ride: PlannedRide) {
		void plan.remove(ride.id).then((err) => {
			if (err) toasts.push(err, { tone: 'error' });
			else
				toasts.push(`Unplanned “${ride.workoutName}”.`, {
					undo: () =>
						void plan.plan(ride.workoutId, ride.day).then((e) => {
							if (e) toasts.push(e, { tone: 'error' });
						}),
				});
		});
	}
</script>

<section class="mt-8" data-testid="your-week">
	<h2 class="eyebrow">your week</h2>
	{#if plan.error}
		<div class="mt-2">
			<Banner tone="error">
				{plan.error}
				{#snippet action()}
					<button onclick={() => void plan.retry()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if plan.loaded && !any}
		<p class="text-muted mt-2 text-sm">
			Nothing planned. Plan one of your workouts on a day from its menu.
		</p>
	{:else if any}
		<ol class="mt-2 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
			{#each days as day (day)}
				{#each plan.on(day) as ride (ride.id)}
					<li class="panel flex items-center gap-2 py-2">
						<div class="min-w-0 flex-1">
							<p class="text-muted text-[11px]">{dayLabel(day, now)}</p>
							<p class="truncate text-sm font-semibold">{ride.workoutName}</p>
						</div>
						<a
							href="/ride?w={ride.workoutId}"
							onclick={(e) => rideClick(e, { pick: ride.workoutId })}
							class="btn btn-primary btn-xs">Ride</a
						>
						<button
							onclick={() => unplan(ride)}
							class="btn btn-ghost btn-xs"
							aria-label="Unplan {ride.workoutName} on {dayLabel(day, now)}"
							><X size={14} /></button
						>
					</li>
				{/each}
			{/each}
		</ol>
	{/if}
</section>
