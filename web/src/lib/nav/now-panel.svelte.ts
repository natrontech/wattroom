/**
 * Which now-bar panel is open, and the buttons that open them. The bar sets
 * it; the voice channel's shell draws the panel, because the jukebox reads
 * the channel's context.
 */
export const nowPanel = $state<{
	open: 'music' | 'react' | null;
	music: HTMLElement | null;
	react: HTMLElement | null;
	/** Asked from the bar, answered by the shell: open the session picker,
	 *  or the ride sheet (#4616) pre-filled with `who` and `pick`. */
	ask: 'session' | 'ride' | null;
	who: 'join' | null;
	pick: string | null;
}>({
	open: null,
	music: null,
	react: null,
	ask: null,
	who: null,
	pick: null,
});
