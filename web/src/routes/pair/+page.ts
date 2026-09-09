import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Sensors are the Equipment section of Settings now. A redirect for one release so bookmarks, older links and the
// server's own redirects still land (#1330, expand/contract), then it goes
// (#1352). In load, not in an effect: nothing mounts, and the query travels —
// an OAuth outcome rides in it. The hash cannot be read in load (SvelteKit
// forbids event.url.hash), and nothing here ever carried one.
export const load: PageLoad = ({ url }) => {
	redirect(302, '/settings/equipment' + url.search);
};
