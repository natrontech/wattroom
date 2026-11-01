import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// The Board is a section of the crew's Home now; old links land there.
export const load: PageLoad = ({ params }) => {
	redirect(307, `/crew/${params.id}`);
};
