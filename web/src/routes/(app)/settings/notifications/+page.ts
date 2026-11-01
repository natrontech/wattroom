import { redirect } from '@sveltejs/kit';

// Merged into /settings/data when Settings came down to four pages.
export const load = () => {
	redirect(307, '/settings/data');
};
