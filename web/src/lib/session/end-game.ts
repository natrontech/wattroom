import type { ChannelContext } from '$lib/channel/context';
import { confirm } from '$lib/confirm.svelte';
import { gameMode } from '$lib/session/modes';

/**
 * Every End game, from one place (#2604): the header's game-pad and the
 * panel's button end the game for everyone in it, and there is no picking a
 * game back up — the cost is paid by other people, so it asks, the way End
 * session does (errors.md). A finished game's podium is cleared without the
 * question: nothing is lost that has not already ended.
 */
export async function endGame(
	channel: Pick<ChannelContext, 'game' | 'control'>,
): Promise<void> {
	const game = channel.game;
	if (!game) return;
	if (game.phase !== 'done') {
		const n = Object.keys(game.riders ?? {}).length;
		const label = gameMode(game.mode)?.label ?? 'the game';
		const ok = await confirm({
			title: n
				? `End ${label} for ${n} rider${n === 1 ? '' : 's'}?`
				: `End ${label}?`,
			body: 'The game stops for everyone in it and cannot be picked back up.',
			action: 'End the game',
			cancel: 'Keep playing',
		});
		if (!ok) return;
	}
	channel.control('game-end');
}
