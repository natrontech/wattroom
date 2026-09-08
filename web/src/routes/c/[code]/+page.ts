import { crewDoor, type CrewDoor } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await crewDoor(params.code, fetch);
	return {
		code: params.code,
		crew: res.ok ? res.data : null,
		error: res.ok ? null : res.error.message,
	} satisfies { code: string; crew: CrewDoor | null; error: string | null };
};
