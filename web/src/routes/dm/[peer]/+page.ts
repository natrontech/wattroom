import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// A DM lives under /messages now (#468); an old link still lands in it.
export const load: PageLoad = ({ params }) => {
	redirect(307, `/messages/dm/${params.peer}`);
};
