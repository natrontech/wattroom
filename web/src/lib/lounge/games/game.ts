/**
 * The arcade cabinet's games (docs/spec/lounge.md): each one button, on a
 * 160 × 90 screen, and pure, so a run is the same on every screen that plays
 * the same seed. The seed is the day's (GET /api/crews/{id}/arcade), so a
 * crew's board compares one course.
 */
import type { Ctx } from '$lib/lounge/pixel';
import { ArcadeBergpreis, ArcadeDarts, ArcadeFeedZone } from '$lib/protocol';

export const SCREEN_W = 160;
export const SCREEN_H = 90;

export type GameId =
	typeof ArcadeBergpreis | typeof ArcadeFeedZone | typeof ArcadeDarts;

/** What a game makes a sound for this frame: the cabinet plays it. */
export type Sound = 'grab' | 'miss' | 'throw' | 'hit' | 'bull';

export interface Game<S> {
	id: GameId;
	name: string;
	/** One line under the name: how to play. */
	how: string;
	/** More than a perfect run can reach: the server's ArcadeMax, which refuses anything over. */
	most: number;
	/** The button's label for a screen reader. */
	button: string;
	start(seed: number): S;
	/** One step of `dt` seconds with the button held or not. */
	step(s: S, dt: number, held: boolean): S;
	over(s: S): boolean;
	score(s: S): number;
	/** What this step should sound, if anything. */
	sound(before: S, after: S): Sound | undefined;
	draw(g: Ctx, s: S): void;
}
