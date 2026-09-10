/**
 * In-app toasts (#230) — errors.md's missing pieces: "background action
 * result → toast" and "undo over confirm". Desk feedback only; ride-critical
 * errors stay persistent dashboard status (FaultBanner), never a toast.
 * Rendered by components/Toasts.svelte in the app layout.
 */
import { play } from '$lib/sound/cues';

export interface Toast {
	id: number;
	text: string;
	tone: 'info' | 'error';
	/** Present ⇒ the action already ran and this reverses it. */
	undo?: () => void;
	/** Present ⇒ the toast is a link to what it is about (#568). */
	href?: string;
}

let items = $state<Toast[]>([]);
let seq = 0;
// The clock each timed toast is on (#1961): paused while the pointer or
// focus is on the stack, so a rider reaching for Undo is not raced by it.
const timers = new Map<
	number,
	{ handle: ReturnType<typeof setTimeout>; due: number; left: number }
>();

function dismiss(id: number) {
	const t = timers.get(id);
	if (t) clearTimeout(t.handle);
	timers.delete(id);
	items = items.filter((toast) => toast.id !== id);
}
function arm(id: number, ms: number) {
	timers.set(id, {
		handle: setTimeout(() => dismiss(id), ms),
		due: Date.now() + ms,
		left: ms,
	});
}

export const toasts = {
	get items() {
		return items;
	},
	/** Undo toasts linger longer — the rider has to spot them first. */
	push(
		text: string,
		opts?: {
			tone?: 'info' | 'error';
			undo?: () => void;
			href?: string;
			seconds?: number;
		},
	) {
		const id = ++seq;
		// An error toast means something the rider asked for did not happen
		// (#834). Sounding it here rather than at forty call sites is also
		// what keeps the next one from being silent by omission.
		if (opts?.tone === 'error') play('fault');
		items.push({
			id,
			text,
			tone: opts?.tone ?? 'info',
			undo: opts?.undo,
			href: opts?.href,
		});
		// An undo toast does not expire (#1961): the action it reverses is
		// already done, and a keyboard rider needs the time to reach it —
		// Dismiss, Undo or the next undo toast is what takes it down.
		if (opts?.undo && opts.seconds === undefined) {
			for (const other of items.filter((t) => t.undo && t.id !== id))
				dismiss(other.id);
			return;
		}
		arm(id, (opts?.seconds ?? 4) * 1000);
	},
	dismiss,
	/** The pointer or focus is on the stack: no toast goes while it is. */
	hold() {
		for (const [id, t] of timers) {
			clearTimeout(t.handle);
			t.left = Math.max(0, t.due - Date.now());
			timers.set(id, t);
		}
	},
	/** Off the stack: the clocks resume where they stopped. */
	release() {
		for (const [id, t] of timers) arm(id, Math.max(t.left, 1000));
	},
};
