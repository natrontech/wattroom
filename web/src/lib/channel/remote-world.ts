import { createCheerBack } from '$lib/channel/cheer-back';
import { askCamera, askPhoto } from '$lib/world/ride-view';

/**
 * The phone remote's Camera, Photo and Cheer as the holding tab runs them
 * (#4253): the world's camera ask and photo ask, the same paths keys 1-4, O
 * and a controller take, and a cheer for the rider who last cheered you.
 * Feed it each tick's cheers with `heard`.
 */
export function createRemoteWorld(deps: {
	me: () => string | undefined;
	cheer: (emoji: string, to?: string) => void;
	/** The rider's own cheers, first the one Cheer sends. */
	deck: () => readonly string[];
	now?: () => number;
}) {
	const now = deps.now ?? Date.now;
	const back = createCheerBack(deps.me);
	return {
		heard: (cheers: Parameters<typeof back.heard>[0]) =>
			back.heard(cheers, now()),
		actions: {
			camera: () => void askCamera(),
			photo: () => void askPhoto(),
			'cheer-back': () =>
				deps.cheer(deps.deck()[0], back.to(now()) || undefined),
		},
	};
}
