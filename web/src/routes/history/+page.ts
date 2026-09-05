import { loadApi } from '$lib/api';
import { fetchProgression, type Progression } from '$lib/progression';
import type { RideRecord } from '$lib/history.svelte';
import type { PageLoad } from './$types';

export interface ServerRide extends RideRecord {
	xp: number;
	room?: boolean;
	/** The per-ride opt-in (ADR-0024): friends see it on your page. */
	sharedWithFriends: boolean;
}

export const load: PageLoad = async ({ fetch }) => {
	const [ridesResult, progressionResult] = await Promise.all([
		loadApi<{ rides: ServerRide[] }>(fetch, '/api/rides'),
		fetchProgression(fetch),
	]);
	return {
		rides: ridesResult.ok ? ridesResult.data.rides : null,
		ridesError: ridesResult.ok ? null : ridesResult.error.message,
		progression: progressionResult.ok ? progressionResult.data : null,
		progressionError: progressionResult.ok
			? null
			: progressionResult.error.message,
	};
};

export type HistoryPageData = {
	rides: ServerRide[] | null;
	ridesError: string | null;
	progression: Progression | null;
	progressionError: string | null;
};
