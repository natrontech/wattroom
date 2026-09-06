/**
 * Whether the Sound panel is up (#914). It used to be `QuickAudio`'s own
 * `open`, which was fine while its button was the only way in; the mic's menu
 * is a second one, and "Tune your gate…" has to reach the surface that holds
 * the meter. One `QuickAudio` is mounted at a time, so this still draws one
 * modal.
 */
import { roomConnection } from '$lib/room/connection.svelte';

export const soundPanel = $state({ open: false });

/**
 * Every way in goes through here, so every way in re-reads the devices: the
 * av store only refreshes them after a connect or a hot-plug, and this panel
 * opens before either (#658).
 */
export function openSoundPanel(): void {
	soundPanel.open = true;
	void roomConnection.current?.av.refreshDevices();
}
