import { apiBlob } from '$lib/api';
import { downloadBlob } from '$lib/download';

/**
 * The ride as a picture (#2112). Strava's API uploads the activity and never
 * a photo for it, so a WattRoom ride gets onto Strava as an image the way
 * every other photo does: the rider saves this and adds it themselves.
 *
 * Drawn by the server (internal/og), so the two surfaces that offer it — the
 * ride's page and the screen a rider is standing at when they want it — ask
 * for a URL rather than each growing a renderer.
 *
 * Returns the server's own sentence on failure, null when the file is away.
 */
export async function downloadRideCard(id: string): Promise<string | null> {
	const res = await apiBlob(`/api/rides/${encodeURIComponent(id)}/card.png`);
	if (!res.ok) return res.error.message;
	downloadBlob(res.data.blob, res.data.filename ?? `wattroom-ride-${id}.png`);
	return null;
}
