import { crewDoor, type CrewDoor } from '$lib/crew';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await crewDoor(params.code, fetch);
	return {
		code: params.code,
		crew: res.ok ? res.data : null,
		error: res.ok ? null : res.error.message,
		// not_found is a wrong code; anything else is a door that could not
		// be asked, and gets a retry (audit 2026-09-09).
		errorCode: res.ok ? null : res.error.error,
	} satisfies {
		code: string;
		crew: CrewDoor | null;
		error: string | null;
		errorCode: string | null;
	};
};
