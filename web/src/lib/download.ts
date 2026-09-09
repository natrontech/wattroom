/**
 * Hand the rider a file the way a link would: an anchor, a click, and the
 * object URL released a tick later — a synchronous revoke is a known way to
 * cancel the download in some browsers. Three surfaces each had their own
 * copy of this dance (audit 2026-09-09).
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
