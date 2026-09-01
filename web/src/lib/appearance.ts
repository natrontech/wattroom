import { api } from '$lib/api';

/**
 * Appearance follows the account (#326): the palette identity and the scheme
 * toggle ride PATCH /api/me/appearance, so the TV in the next room shows the
 * same room. Fire-and-forget — the local key already holds the choice, so a
 * failed sync costs the second device, never this one.
 */
export function syncAppearance(patch: {
	accentPalette?: string;
	colorScheme?: string;
}): void {
	void api('/api/me/appearance', { method: 'PATCH', json: patch });
}
