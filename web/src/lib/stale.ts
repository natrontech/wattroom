/**
 * Reads failed in a row before a feed is marked stale (#1743): the SECOND
 * failure, never the first — the fallback poll already covers a one-off, and
 * a mark that flickers on every blip teaches people to ignore it. The crew
 * list's and the crews' live read's alike (#2518).
 */
export const STALE_AFTER = 2;
