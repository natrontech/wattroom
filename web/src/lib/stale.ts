/**
 * Reads failed in a row before a feed is marked stale (#1743): the SECOND
 * failure, never the first — the fallback poll already covers a one-off, and
 * a mark that flickers on every blip teaches people to ignore it. The crew
 * list's and the crews' live read's alike (#2518).
 */
export const STALE_AFTER = 2;

/**
 * Orders the overlapping reads of one feed (#2565). A response older than one
 * already applied is dropped, so a slow success can neither clear a newer
 * failure's count nor put an older list back; every other response lands, so
 * two overlapping failures are two failures. `begin()` numbers a read as it
 * is asked, `lands(n)` says whether its answer may be applied, and `reset()`
 * drops everything still in flight.
 */
export function readOrder() {
	let asked = 0;
	let applied = 0;
	return {
		begin: () => ++asked,
		lands(n: number) {
			if (n < applied) return false;
			applied = n;
			return true;
		},
		reset() {
			applied = ++asked;
		},
	};
}

/**
 * One read of a feed at a time (#4565). Asked while a read is in flight, it
 * starts no second one: it runs ONE more when that lands, however many asks
 * arrived, because a ping may be about something newer than the read already
 * on its way. So every ask ends in a read that began after it, and a burst of
 * pings costs two reads instead of one each. The promise settles when that
 * read has landed; a read's failure is its own to report. `reset()` forgets
 * what is in flight and queued: the next ask starts at once.
 */
export function latestRead(read: () => Promise<unknown>) {
	let epoch = 0;
	let flying: Promise<void> | null = null;
	let queued: Promise<void> | null = null;
	function fly(): Promise<void> {
		const one: Promise<void> = (async () => {
			try {
				await read();
			} catch {
				// Reported where it is read; the queue behind it still runs.
			}
		})().then(() => {
			if (flying === one) flying = null;
		});
		return one;
	}
	function ask(): Promise<void> {
		if (!flying) return (flying = fly());
		const mine = epoch;
		return (queued ??= flying.then(() => {
			if (epoch !== mine) return;
			queued = null;
			return (flying = fly());
		}));
	}
	ask.reset = () => {
		epoch += 1;
		flying = null;
		queued = null;
	};
	return ask;
}

/**
 * Whether a follower of the lobby ping's count (`presence.version`) reads
 * for the count it now sees (#4565). The first it sees is its own mount:
 * read. A count that did not move is no ping. And the step from zero is the
 * feed's own first answer, asked in the same moment as the follower's mount
 * read: nothing new, so it is skipped. A follower that reads on mount by
 * itself passes the count it mounted on, and is told of the pings only.
 */
export function pingFollower(mounted: number | null = null) {
	let seen = mounted;
	return (version: number): boolean => {
		const was = seen;
		seen = version;
		if (was === null) return true;
		return version !== was && was !== 0;
	};
}
