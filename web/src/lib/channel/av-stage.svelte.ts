/**
 * What the stage can show, and which of it you are looking at.
 *
 * Split out of av.svelte.ts (#892): pure bookkeeping over ids, with no
 * LiveKit and no WebAudio in it — the connection tells it what appeared and
 * what went away, and the stage draws whatever it holds.
 */

export type StageSource = {
	key: string;
	id: string;
	kind: 'screen' | 'cam';
	gen: number;
};

export type Stage = ReturnType<typeof createStage>;

export function createStage() {
	/** Rider ids with a live camera track — bumped to retrigger attach. */
	let videoOf = $state<Record<string, number>>({});
	/**
	 * Every live screenshare (#280). #206's projector kept exactly one — a
	 * second sharer silently stole the room's screen. LiveKit was always fine
	 * with many; only the UI insisted on one, so keep them all in arrival
	 * order (last = newest) and let the viewer choose.
	 */
	let screens = $state<{ id: string; key: number }[]>([]);
	let seq = 0;
	/**
	 * What YOU want on the stage: a `screen:`/`cam:` key, or null = newest
	 * share. Yours alone — a stage pick is a glance, never room state.
	 */
	let pick = $state<string | null>(null);

	return {
		get videoOf() {
			return videoOf;
		},
		get pick() {
			return pick;
		},
		setPick(key: string | null) {
			pick = key;
		},
		/** Is this rider's camera currently up? */
		hasVideo(id: string) {
			return Boolean(videoOf[id]);
		},
		addScreen(id: string) {
			seq += 1;
			screens = [...screens.filter((s) => s.id !== id), { id, key: seq }];
		},
		dropScreen(id: string) {
			screens = screens.filter((s) => s.id !== id);
			// A sharer stopping must not blank the stage for everyone — falling
			// back to null lets the derived pick the next newest share (#206).
			if (pick === `screen:${id}`) pick = null;
		},
		bumpVideo(id: string) {
			videoOf = { ...videoOf, [id]: (videoOf[id] ?? 0) + 1 };
		},
		// A camera turning OFF must clear the flag — bumping it left a blank
		// tile claiming "camera on" for the rest of the session (audit #219).
		dropVideo(id: string) {
			const next = { ...videoOf };
			delete next[id];
			videoOf = next;
		},
		/**
		 * The stage's menu: every share, then every open camera. Screens lead
		 * because a shared screen is why anyone looks at the stage at all.
		 */
		get sources(): StageSource[] {
			return [
				...screens.map((s) => ({
					key: `screen:${s.id}`,
					id: s.id,
					kind: 'screen' as const,
					gen: s.key,
				})),
				...Object.entries(videoOf).map(([id, gen]) => ({
					key: `cam:${id}`,
					id,
					kind: 'cam' as const,
					gen,
				})),
			];
		},
		/** Everything gone: a leave, or a connection torn down. */
		clear() {
			videoOf = {};
			screens = [];
			pick = null;
		},
	};
}
