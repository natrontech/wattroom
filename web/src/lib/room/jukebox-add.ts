/** Paste-a-URL, the golden path — shared by the jukebox tile and the side panel. */
export function videoIdFrom(input: string): string | null {
	const trimmed = input.trim();
	if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
	try {
		const u = new URL(trimmed);
		const v = u.searchParams.get('v');
		if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
		const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
		if (/^[A-Za-z0-9_-]{11}$/.test(last)) return last;
	} catch {
		/* not a URL */
	}
	return null;
}

/** Resolve a title via keyless oEmbed and send the add; failure costs only the label. */
export async function addYouTubeUrl(
	url: string,
	send: (action: string, videoId?: string, title?: string) => void,
): Promise<boolean> {
	const videoId = videoIdFrom(url);
	if (!videoId) return false;
	let title = videoId;
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
		);
		if (res.ok) title = (await res.json()).title ?? videoId;
	} catch {
		/* title stays the id */
	}
	send('add', videoId, title);
	return true;
}
