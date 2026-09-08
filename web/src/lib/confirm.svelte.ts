/**
 * The in-app confirm (#1127): errors.md's exception to "undo over confirm",
 * for the handful of actions nothing can put back. One question is open at a
 * time; `ConfirmHost` in the root layout draws it on `Modal`, and a call site
 * just awaits `confirm({...})` where it used to call the browser's own.
 */
export interface ConfirmRequest {
	title: string;
	body?: string;
	/** The button that does it — "Delete track", not "OK". */
	action: string;
	/** The button that doesn't. */
	cancel?: string;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let current = $state.raw<Pending | null>(null);

/** Ask, and resolve to whether the rider pressed the action. */
export function confirm(request: ConfirmRequest): Promise<boolean> {
	// A second question replaces the first, which is then declined: a caller
	// left awaiting a dialog that no longer exists is a dead button.
	current?.resolve(false);
	return new Promise((resolve) => {
		current = { ...request, resolve };
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
