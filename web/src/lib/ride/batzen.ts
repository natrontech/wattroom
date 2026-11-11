/**
 * What a saved ride put in the wallet (#4515), as the server answers it: the
 * save's own answer for a ride alone, the ride's own read for a session's.
 * Only ever the rider's own card; nothing shared carries it.
 */
export interface RideBatzen {
	earned: number;
	/** The day's cap paid less than the ride's minutes earned. */
	held?: boolean;
}

/** docs/spec/garage.md "Earning Batzen": at most this many per UTC day. */
export const BATZEN_DAY_CAP = 180;
