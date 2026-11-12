/**
 * `?perf` (#4541): the perf overlay and the `wattroom:` trace measures, for
 * this tab. `?perf` or `?perf=1` turns it on and keeps it on across reloads
 * and navigation in the tab (sessionStorage); `?perf=0` turns it off. Read
 * once, when the app loads: off, every hook below is one false check.
 */
export const PERF_KEY = 'wattroom.perf.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether this load measures: the URL's say first, then what the tab kept. */
export function readPerfFlag(search: string, store: Store | null): boolean {
	const asked = new URLSearchParams(search).get('perf');
	try {
		if (asked === '0' || asked === 'off') {
			store?.removeItem(PERF_KEY);
			return false;
		}
		if (asked !== null) {
			store?.setItem(PERF_KEY, '1');
			return true;
		}
		return store?.getItem(PERF_KEY) === '1';
	} catch {
		// Storage refused (a locked-down profile): the URL alone decides.
		return asked !== null && asked !== '0' && asked !== 'off';
	}
}

function storage(): Store | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

export const perfOn: boolean =
	typeof location !== 'undefined' && readPerfFlag(location.search, storage());
