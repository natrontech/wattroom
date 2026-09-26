import { error } from '@sveltejs/kit';
import { rival, RIVALS } from '$lib/site/rivals';
import type { EntryGenerator, PageLoad } from './$types';

// One page per rival in rivals.ts, written out at build time (ADR-0061).
export const entries: EntryGenerator = () =>
	RIVALS.map((r) => ({ rival: r.slug }));

export const load: PageLoad = ({ params }) => {
	const found = rival(params.rival);
	if (!found) error(404, 'No such comparison');
	return { rival: found };
};
