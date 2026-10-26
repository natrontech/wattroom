import type { Block } from '$lib/workout/block';
import type { HudBlock } from './feed';

/**
 * What the HUD is sent of slot 1's block (#4212): nothing where it would
 * only repeat the ride's clock (one block) or has no clock of its own (a
 * route's road block, which the road ends).
 */
export function hudBlock(
	block: Block | null | undefined,
): HudBlock | undefined {
	if (!block || block.count < 2 || block.trainer.kind === 'road') return;
	return { secondsLeft: block.secondsLeft, next: block.next, rep: block.rep };
}
