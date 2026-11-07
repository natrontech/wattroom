import { BERGPREIS } from './bergpreis';
import { DARTS_GAME } from './darts';
import { FEED_ZONE } from './feedzone';
import type { Game, GameId } from './game';

/** The cabinet's games, in the order its picker shows them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAMES: Game<any>[] = [BERGPREIS, FEED_ZONE, DARTS_GAME];

export const gameOf = (id: GameId) =>
	GAMES.find((g) => g.id === id) ?? BERGPREIS;
