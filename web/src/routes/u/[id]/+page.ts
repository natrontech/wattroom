import { loadApi } from '$lib/api';
import { fetchRider, type Rider } from '$lib/rider';
import { fetchTrophies, type Trophies } from '$lib/trophies/trophies';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	// /u/me is your own page (#1330): one read to learn who "me" is, then
	// the same two the page always did. Signed out, "me" resolves to nothing
	// and the page says so the way an unknown id would.
	let id = params.id;
	if (id === 'me') {
		const me = await loadApi<{ id?: string }>(fetch, '/api/me');
		if (!me.ok || !me.data?.id) {
			// Nothing to ask for: an empty id would not even reach the API
			// (the SPA answers /api/riders/), and the page would wait forever.
			return {
				id: '',
				rider: null,
				riderError: me.ok
					? 'Could not tell who you are — reload to try again.'
					: me.error.message,
				riderMissing: false,
				trophies: null,
				trophiesError: null,
			};
		}
		id = me.data.id;
	}
	const [riderResult, trophiesResult] = await Promise.all([
		fetchRider(id, fetch),
		fetchTrophies(id, fetch),
	]);
	return {
		id,
		rider: riderResult.ok ? riderResult.data : null,
		riderError: riderResult.ok ? null : riderResult.error.message,
		riderMissing: !riderResult.ok && riderResult.error.error === 'not_found',
		trophies: trophiesResult.ok ? trophiesResult.data : null,
		trophiesError: trophiesResult.ok ? null : trophiesResult.error.message,
	};
};

export type RiderPageData = {
	id: string;
	rider: Rider | null;
	riderError: string | null;
	/** Absent or not visible to you (#1555): retrying cannot find it. */
	riderMissing: boolean;
	trophies: Trophies | null;
	/** Read on your own page only: there the case is the page (#1330). */
	trophiesError: string | null;
};
