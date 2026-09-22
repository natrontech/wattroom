import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Retired twice: by ADR-0020 into Home, and with the rooms themselves
// (#2458). What it listed is crews now, and the list of those is the
// directory.
export const load: PageLoad = () => {
	redirect(307, '/crews/directory');
};
