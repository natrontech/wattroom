/**
 * In-app toasts (#230) — errors.md's missing pieces: "background action
 * result → toast" and "undo over confirm". Desk feedback only; ride-critical
 * errors stay persistent dashboard status (FaultBanner), never a toast.
 * Rendered by components/Toasts.svelte in the app layout.
 */

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

function dismiss(id: number) {
	items = items.filter((toast) => toast.id !== id);
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
		items.push({
			id,
			text,
			tone: opts?.tone ?? 'info',
			undo: opts?.undo,
			href: opts?.href,
		});
		setTimeout(
			() => dismiss(id),
			(opts?.seconds ?? (opts?.undo ? 8 : 4)) * 1000,
		);
	},
	dismiss,
};
