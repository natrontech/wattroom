import { toasts } from '$lib/toast.svelte';

/**
 * Text onto the clipboard, and what the rider is told either way (#2182).
 *
 * `navigator.clipboard.writeText` is refused often enough to matter — no
 * permission, a page that lost focus, a browser that wants a gesture it
 * decided this was not — and half the call sites said "copied." without
 * waiting to find out. A copy that silently did not happen is discovered at
 * the paste, where nothing explains it (errors.md).
 */
export async function copyText(text: string, copied: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		toasts.push(copied);
	} catch {
		toasts.push('Copy needs clipboard permission.', { tone: 'error' });
	}
}
