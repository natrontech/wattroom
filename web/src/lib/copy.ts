import { toasts } from '$lib/toast.svelte';

/**
 * Text onto the clipboard, and what the rider is told either way (#2182,
 * #2180).
 *
 * `navigator.clipboard.writeText` is refused often enough to matter — no
 * permission, a page that lost focus, a browser that wants a gesture it
 * decided this was not — and some call sites said "copied." without waiting
 * to find out. A copy that silently did not happen is discovered at the
 * paste, where nothing explains it (errors.md). Six copies had written this
 * out, with three different wordings for the same refusal.
 *
 * `refused` is for the copies that can do better than "it did not work":
 * where the text is a link, the link itself is the feedback and the toast
 * holds it long enough to be read (#1764). It is never the answer for
 * something secret — a token's fallback says where to select it, not what it
 * is.
 */
export async function copyText(
	text: string,
	copied: string,
	refused?: { message: string; seconds?: number },
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		toasts.push(copied);
	} catch {
		toasts.push(refused?.message ?? 'Copy needs clipboard permission.', {
			tone: 'error',
			seconds: refused?.seconds,
		});
	}
}

/** The fallback for a link: the rider can read it out of the toast (#1764). */
export const theLinkItself = (link: string) => ({
	message: `Could not copy — the link is ${link}`,
	seconds: 12,
});
