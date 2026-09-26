import { loadApi } from '$lib/api';
import { fetchProgression, type Progression } from '$lib/progression';
// The list's shapes live in $lib (#2064): a +page.ts may only export `load`
// and its siblings, and a helper beside it fails the route at runtime with
// "Invalid export" — a 500 on /history that neither svelte-check nor the
// unit tests can see.
import {
	rideCursorOf,
	type RideCursor,
	type RidesPage,
	type ServerRide,
} from '$lib/ride/list';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [ridesResult, progressionResult] = await Promise.all([
		loadApi<RidesPage>(fetch, '/api/rides'),
		fetchProgression(fetch),
	]);
	const cursor = ridesResult.ok ? rideCursorOf(ridesResult.data) : null;
	return {
		rides: ridesResult.ok ? ridesResult.data.rides : null,
		more: ridesResult.ok ? !!ridesResult.data.more && !!cursor : false,
		cursor,
		ridesError: ridesResult.ok ? null : ridesResult.error.message,
		progression: progressionResult.ok ? progressionResult.data : null,
		progressionError: progressionResult.ok
			? null
			: progressionResult.error.message,
	};
};

export type HistoryPageData = {
	rides: ServerRide[] | null;
	/** The server has older rides than the page holds (#1549). */
	more: boolean;
	/** Where the next page starts, or null when this is the whole list. */
	cursor: RideCursor | null;
	ridesError: string | null;
	progression: Progression | null;
	progressionError: string | null;
};
