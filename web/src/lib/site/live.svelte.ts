import { api } from '$lib/api';

/**
 * The public pages' live numbers: riders online right now, and the repo's
 * stars. Both come from the server (one poll, no visitor calls GitHub). A
 * failure or a zero leaves them at zero, and the pages hide a zero rather
 * than advertise that nobody is here.
 */
export const live = $state({ online: 0, stars: 0 });

/** Polls while a page is open; the returned function stops it. */
export function watchLive(): () => void {
	const tick = async () => {
		const res = await api<{ online: number; stars: number }>('/api/live');
		live.online = res.ok ? res.data.online : 0;
		live.stars = res.ok ? res.data.stars : 0;
	};
	void tick();
	const id = setInterval(tick, 20_000);
	return () => clearInterval(id);
}
