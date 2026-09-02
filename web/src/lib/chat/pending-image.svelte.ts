import { compressImage } from '$lib/chat/media';

/**
 * A picture waiting on the send button (#279) — Discord's flow: Ctrl+V (or
 * pick a file), see the chip, hit Enter. One holder for every composer that
 * sends images: the room's side panel, a DM, a room thread read from
 * outside (#468). The composer owns the input; this owns the blob.
 */
export function createPendingImage(onRefused: (message: string) => void) {
	let current = $state<{ blob: Blob; preview: string } | null>(null);

	function clear() {
		if (current) URL.revokeObjectURL(current.preview);
		current = null;
	}

	async function hold(file: File | null | undefined) {
		if (!file) return;
		const blob = await compressImage(file);
		if (!blob) {
			onRefused('That image cannot be sent — GIFs are capped at 2 MB.');
			return;
		}
		clear();
		current = { blob, preview: URL.createObjectURL(blob) };
	}

	return {
		get current() {
			return current;
		},
		/** A paste with a picture on the clipboard; text pastes stay the input's business. */
		paste(e: ClipboardEvent) {
			const file = Array.from(e.clipboardData?.items ?? [])
				.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
				?.getAsFile();
			if (!file) return;
			e.preventDefault();
			void hold(file);
		},
		/** A file the rider picked. */
		pick(file: File | null | undefined) {
			void hold(file);
		},
		clear,
		/** Hand the blob to the send and forget it. */
		take(): Blob | undefined {
			const blob = current?.blob;
			clear();
			return blob;
		},
	};
}
