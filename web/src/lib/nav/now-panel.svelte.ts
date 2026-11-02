/**
 * Which now-bar panel is open, and the buttons that open them. The bar sets
 * it; the voice channel's shell draws the panel, because the jukebox reads
 * the channel's context.
 */
export const nowPanel = $state<{
	open: 'music' | 'react' | null;
	music: HTMLElement | null;
	react: HTMLElement | null;
}>({ open: null, music: null, react: null });
