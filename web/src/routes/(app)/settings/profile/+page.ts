import { fetchProgression, type TrendRide } from '$lib/progression';
import type { PageLoad } from './$types';

// The FTP trend the Profile section charts; on failure it simply does not
// render — the chart is a nice-to-have, the form is the page.
export const load: PageLoad = async ({ fetch }) => {
	const res = await fetchProgression(fetch);
	return { trend: res.ok ? (res.data?.rides ?? []) : [] };
};

export type ProfilePageData = { trend: TrendRide[] };
