import { copyText, theLinkItself } from '$lib/copy';
import { device } from '$lib/device.svelte';

/**
 * A link handed to another person (#973).
 *
 * Every surface that gives a link away had grown its own clipboard call, and
 * none of them had the one a phone actually wants: `navigator.share` puts the
 * link into WhatsApp, Signal or a message in a single tap, where a copy costs
 * an app switch and a paste — and the rider inviting someone is on a phone
 * more often than at a desk (#124).
 *
 * **A finger, deliberately.** `navigator.share` exists on desktop Chrome too,
 * where it opens an OS share dialog in place of the copy a rider at a desk is
 * reaching for — the link is going into the Discord window next to this one,
 * not into another application. So a mouse keeps the clipboard and nothing
 * about the desktop behaviour changes; `shareVerb` below is what stops the
 * button promising one and doing the other.
 *
 * **Nothing is titled.** What a share target draws is the link's own preview,
 * which the server already writes (og, #240). A title passed here would be a
 * second description of the same page, in a second place, going stale on its
 * own schedule — which is the half of #973 that shipped.
 */
export async function shareLink(link: string, copied: string): Promise<void> {
	if (canShare()) {
		try {
			await navigator.share({ url: link });
			return;
		} catch (err) {
			// The rider closed the sheet: nothing was lost and nothing was
			// promised, so nothing is said — and the clipboard must not be
			// written behind their back under a toast claiming a copy they
			// never asked for (errors.md: a tap that loses nothing stays quiet).
			if (dismissed(err)) return;
			// Anything else — no permission, no transient activation left, a
			// shell that declares `share` and cannot perform one — is a share
			// that did not happen, and the clipboard still works.
		}
	}
	await copyText(link, copied, theLinkItself(link));
}

/**
 * The word a button uses for it, so the label cannot promise a copy and open
 * a share sheet instead (`ux.md`: items say what happens). Reads `device`, so
 * a template that calls it re-reads when the pointer does.
 */
export function shareVerb(): 'Share' | 'Copy' {
	return canShare() ? 'Share' : 'Copy';
}

/** Whether this device shares rather than copies: an API, and a finger. */
function canShare(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		typeof navigator.share === 'function' &&
		device.coarse
	);
}

/** The share sheet the rider dismissed, which is not a failure. */
function dismissed(err: unknown): boolean {
	return (err as { name?: unknown } | null)?.name === 'AbortError';
}
