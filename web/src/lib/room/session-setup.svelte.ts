import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';
import { buildShelf } from '$lib/workout/shelf';
import { customWorkouts } from '$lib/workout/custom.svelte';
import { parseSharedSegments } from '$lib/room/workout';

/**
 * Picking something to ride, and starting something already planned (#115,
 * #116).
 *
 * Composed, not owned (code-quality.md) — the same shape `createSummary` and
 * `createRiders` already take out of the shell: this module holds the state
 * and the shell wires it to the connection. Lifted in #686 because the shelf,
 * its ranking and the ICS link are one concern and none of it is about being
 * a shell.
 */
export interface SessionSetupDeps {
	/** A getter, not a value: the shell outlives a room change (#173). */
	slug: () => string;
	/** The room's calendar token, for the subscribe URL. */
	icsToken: () => string;
	/** Cleared before a planned ride starts: a new session is a new record. */
	/** The room's control channel — `pick` then `start`. */
	control: (
		action: 'pick' | 'start',
		payload?: { name: string; json: string; totalSeconds: number },
	) => void;
}

export function createSessionSetup(deps: SessionSetupDeps) {
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

	function copyIcsUrl() {
		const link = `${location.origin}/api/rooms/${deps.slug()}/calendar/${deps.icsToken()}.ics`;
		// A denied clipboard used to get the same "copied" (#1764).
		void navigator.clipboard.writeText(link).then(
			() =>
				toasts.push(
					'Calendar link copied — subscribe "from URL" in your calendar app.',
				),
			() =>
				toasts.push(`Could not copy — the link is ${link}`, {
					tone: 'error',
					seconds: 12,
				}),
		);
	}

	/** Start something already on the calendar, now. */
	function startScheduled(entry: {
		id: string;
		workoutName: string;
		workoutJson: string;
	}) {
		const segments = parseSharedSegments(entry.workoutJson);
		const total = segments.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		// A workout that parses to nothing has no timeline to run — and the
		// coach who tapped Start is told, not left with a button that did
		// nothing (errors.md).
		if (total === 0) {
			toasts.push(
				'That planned workout can no longer be read — pick another.',
				{ tone: 'error' },
			);
			return;
		}
		deps.control('pick', {
			name: entry.workoutName,
			json: entry.workoutJson,
			totalSeconds: total,
		});
		deps.control('start');
		// The plan is done with (#1905): marked, it stops offering itself while
		// its own session runs and after. Best effort — the session is already
		// running, and a refusal here is a plan that lingers, not a ride lost.
		void api(`/api/rooms/${deps.slug()}/schedule/${entry.id}/started`, {
			method: 'POST',
		});
	}

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
		copyIcsUrl,
		startScheduled,
	};
}
