/**
 * The in-app confirm (#1127): errors.md's exception to "undo over confirm",
 * for the handful of actions nothing can put back. One question is open at a
 * time; `ConfirmHost` in the root layout draws it on `Modal`, and a call site
 * just awaits `confirm({...})` where it used to call the browser's own.
 *
 * The safe answer is spelled **"Keep it"**, and confirm() spells it: call
 * sites do not restate it (errors.md). It had grown seven spellings — Stay,
 * Keep, Keep them, Keep the room, plus four callers falling through to a bare
 * "Cancel" (#2008) — and then six more once every caller had to pass one
 * (#2887). A rider three meters from the screen reads the shape of the pair,
 * not the sentence. The one exception is a question asked mid-effort, where
 * the safe answer says what the rider is doing instead of what they are
 * keeping: /ride, a session and a game say "Keep riding", /ramp says "Keep
 * going" — and the type admits nothing else. If a new spelling seems right,
 * the action's title is what needs the rewrite.
 */
export interface ConfirmRequest {
	title: string;
	body?: string;
	/** The button that does it — "Delete track", not "OK". */
	action: string;
	/** Only a question asked mid-effort names the safe answer; everything
	 *  else gets "Keep it". */
	cancel?: 'Keep riding' | 'Keep going';
}

type Pending = Omit<ConfirmRequest, 'cancel'> & {
	cancel: string;
	resolve: (ok: boolean) => void;
};

let current = $state.raw<Pending | null>(null);

/** Ask, and resolve to whether the rider pressed the action. */
export function confirm(request: ConfirmRequest): Promise<boolean> {
	// A second question replaces the first, which is then declined: a caller
	// left awaiting a dialog that no longer exists is a dead button.
	current?.resolve(false);
	return new Promise((resolve) => {
		current = { ...request, cancel: request.cancel ?? 'Keep it', resolve };
	});
}

export const confirmation = {
	get current() {
		return current;
	},
	settle(ok: boolean) {
		const asked = current;
		current = null;
		asked?.resolve(ok);
	},
};
