import { api } from '$lib/api';
import { buildShelf } from '$lib/workout/shelf';
import { customWorkouts } from '$lib/workout/custom.svelte';

/**
 * Picking something to ride (#115).
 *
 * Composed, not owned (code-quality.md) — the same shape `createSummary` and
 * `createRiders` already take out of the shell: this module holds the state
 * and the shell wires it to the picker. Lifted in #686 because the shelf and
 * its ranking are one concern and none of it is about being a shell.
 */
export function createSessionSetup() {
	let open = $state(false);
	let intent = $state<'start' | 'plan'>('start');
	const custom = customWorkouts();
	// Recently ridden first: the rider's history ranks the shelf.
	let recency = $state<Map<string, number>>(new Map());

	$effect(() => {
		if (!open || recency.size) return;
		void api<{ rides: { workoutName: string }[] }>('/api/rides').then((res) => {
			if (!res.ok) return;
			const ranked = new Map<string, number>();
			res.data.rides.forEach((ride, i) => {
				if (!ranked.has(ride.workoutName)) ranked.set(ride.workoutName, i);
			});
			recency = ranked;
		});
	});

	const shelf = $derived(
		buildShelf(custom.all)
			.map((entry) => ({ ...entry, recent: recency.has(entry.workout.name) }))
			.sort(
				(a, b) =>
					(recency.get(a.workout.name) ?? 999) -
					(recency.get(b.workout.name) ?? 999),
			),
	);

	return {
		get open() {
			return open;
		},
		set open(next: boolean) {
			open = next;
		},
		get intent() {
			return intent;
		},
		set intent(next: 'start' | 'plan') {
			intent = next;
		},
		get shelf() {
			return shelf;
		},
		custom,
	};
}
