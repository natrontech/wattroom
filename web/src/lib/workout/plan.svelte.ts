/**
 * The rider's own plan (#4615): shelf workouts on days of their week, seen by
 * them alone and mailed to nobody. The crew schedule is the plan a crew sees;
 * this is the one Home reads to offer today's ride. An agent writes it over
 * MCP too, so it reads again when the window comes back, as the shelf does.
 */
import { api } from '#lib/api.ts';

export type PlannedRide = {
	id: string;
	/** The rider's own date, YYYY-MM-DD. */
	day: string;
	workoutId: string;
	workoutName: string;
};

/** How far the plan reads ahead: this week, today first. */
export const PLAN_DAYS = 7;

/** A date as the rider's own calendar names it, YYYY-MM-DD. */
export function localDay(at: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Today and the days after it, as local dates. */
export function weekFrom(today: Date, days = PLAN_DAYS): string[] {
	return Array.from({ length: days }, (_, i) =>
		localDay(
			new Date(today.getFullYear(), today.getMonth(), today.getDate() + i),
		),
	);
}

/** "Today", "Tomorrow", else the weekday and date: "Thu 19". */
export function dayLabel(day: string, today: Date): string {
	const [week0, week1] = weekFrom(today, 2);
	if (day === week0) return 'Today';
	if (day === week1) return 'Tomorrow';
	const [y, m, d] = day.split('-').map(Number);
	const at = new Date(y, m - 1, d);
	return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${d}`;
}

function createPlanStore() {
	let rides = $state<PlannedRide[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let reading: Promise<void> | null = null;
	let readAt = 0;

	async function read(): Promise<void> {
		const days = weekFrom(new Date());
		const res = await api<{ plans: PlannedRide[] }>(
			`/api/plan?from=${days[0]}&to=${days[days.length - 1]}`,
		);
		loaded = true;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		rides = res.data?.plans ?? [];
		error = null;
	}

	function refresh(): Promise<void> {
		return (reading ??= read().finally(() => {
			reading = null;
			readAt = Date.now();
		}));
	}

	/** Reads unless a read answered in the last 10 s. */
	function fresh(): Promise<void> {
		if (reading) return reading;
		if (readAt && Date.now() - readAt < 10_000) return Promise.resolve();
		return refresh();
	}

	if (typeof window !== 'undefined')
		window.addEventListener('focus', () => void fresh());

	return {
		get rides(): PlannedRide[] {
			return rides;
		},
		get loaded(): boolean {
			return loaded;
		},
		get error(): string | null {
			return error;
		},
		fresh,
		retry: refresh,
		on(day: string): PlannedRide[] {
			return rides.filter((r) => r.day === day);
		},
		/** Returns an error message, or null. */
		async plan(workoutId: string, day: string): Promise<string | null> {
			const res = await api('/api/plan', {
				method: 'POST',
				json: { workoutId, day },
			});
			if (!res.ok) return res.error.message;
			await reading;
			await refresh();
			return null;
		},
		/** Returns an error message, or null. */
		async remove(id: string): Promise<string | null> {
			const res = await api(`/api/plan/${encodeURIComponent(id)}`, {
				method: 'DELETE',
			});
			if (!res.ok) return res.error.message;
			rides = rides.filter((r) => r.id !== id);
			return null;
		},
	};
}

let shared: ReturnType<typeof createPlanStore> | null = null;
/** One plan per app, read on first use. */
export function myPlan(): ReturnType<typeof createPlanStore> {
	if (!shared) {
		shared = createPlanStore();
		void shared.retry();
	}
	return shared;
}
