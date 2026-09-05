import { fetchRider, type Rider } from '$lib/rider';
import { fetchTrophies, type Trophies } from '$lib/trophies/trophies';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [riderResult, trophiesResult] = await Promise.all([
		fetchRider(params.id, fetch),
		fetchTrophies(params.id, fetch),
	]);
	return {
		id: params.id,
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
