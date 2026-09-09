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
				trophies: null,
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
		trophies: trophiesResult.ok ? trophiesResult.data : null,
	};
};

export type RiderPageData = {
	id: string;
	rider: Rider | null;
	riderError: string | null;
	trophies: Trophies | null;
};
