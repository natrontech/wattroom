/**
 * Pasted chat media (#279): what leaves the clipboard, and which message
 * texts render as an inline GIF instead of a line of text.
 */

// Direct-media GIF hosts rendered inline. An allowlist, because an <img> to
// an arbitrary pasted host would hand every member's IP to that host.
const GIF_HOSTS =
	/^(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)$/;

/** The message is exactly one allowlisted GIF URL → that URL, else null. */
export function gifUrl(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === '' || /\s/.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' || !GIF_HOSTS.test(url.hostname)) {
			return null;
		}
		return /\.(gif|webp)$/i.test(url.pathname) ? url.href : null;
	} catch {
		return null;
	}
}

/** The server's upload cap — checked client-side first for a good error. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_DIMENSION = 1600;

/**
 * Shrink a pasted image to a WebP the upload cap never bites; GIFs pass
 * through untouched (recompression would freeze the animation). Null when
 * the blob can't be sent (over-cap GIF, decode failure).
 */
export async function compressImage(file: Blob): Promise<Blob | null> {
	if (file.type === 'image/gif') {
		return file.size <= MAX_IMAGE_BYTES ? file : null;
	}
	try {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(
			1,
			MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
		);
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		canvas
			.getContext('2d')
			?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/webp', 0.8),
		);
		return blob && blob.size <= MAX_IMAGE_BYTES ? blob : null;
	} catch {
		return null;
	}
}
