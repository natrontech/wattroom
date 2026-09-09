import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** /settings is the tree, not a page: it opens on the first section. */
export const load: PageLoad = () => {
	redirect(302, '/settings/profile');
};
