<script lang="ts">
	/**
	 * Put one shelf workout on a day of the rider's own week (#4615): seven
	 * big buttons, today first. No typing, no time: a plan is a day.
	 */
	import Modal from '#lib/components/Modal.svelte';
	import { toasts } from '#lib/toast.svelte.ts';
	import { dayLabel, myPlan, weekFrom } from '#lib/workout/plan.svelte.ts';

	let {
		workoutId,
		name,
		onclose,
	}: { workoutId: string; name: string; onclose: () => void } = $props();

	const plan = myPlan();
	const now = new Date();
	let busy = $state(false);

	async function pick(day: string) {
		busy = true;
		const err = await plan.plan(workoutId, day);
		busy = false;
		if (err) {
			toasts.push(err, { tone: 'error' });
			return;
		}
		toasts.push(`“${name}” planned for ${dayLabel(day, now).toLowerCase()}.`);
		onclose();
	}
</script>

<Modal label="Plan it on a day" {onclose} class="max-w-sm">
	<p class="eyebrow">plan it on a day</p>
	<p class="mt-1 truncate text-sm font-semibold">{name}</p>
	<p class="text-muted mt-1 text-xs">
		Only you see your plan. Home offers it on the day.
	</p>
	<div class="mt-4 grid grid-cols-2 gap-2">
		{#each weekFrom(now) as day (day)}
			<button
				disabled={busy}
				onclick={() => void pick(day)}
				class="btn btn-secondary">{dayLabel(day, now)}</button
			>
		{/each}
	</div>
</Modal>
