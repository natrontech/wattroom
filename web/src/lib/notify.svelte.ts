/**
 * Notifications (#202, ADR-0042): room events reach a rider who is not
 * looking — chat, arrivals, a session starting, a poke.
 *
 * "Not looking" is the tab being hidden OR the window not being the front
 * one: Discord's rule, and the right one for a desktop app whose window sits
 * open behind a film. A focused, visible room speaks for itself.
 *
 * In a browser this is off until the rider flips the switch — browsers demand
 * the gesture for the permission anyway. In the desktop shell it is on unless
 * switched off: whoever installed an app expects it to tap them on the
 * shoulder, and the shell grants the permission itself. There, a click on
 * the notification lands in the conversation and, on macOS, the notification
 * carries a reply field; in a browser a click does the same and there is no
 * reply.
 */
const KEY = 'wattroom.notify.v1'; // '1' on, '0' off; the shell's default is on

interface ShellNotification {
	title: string;
	body: string;
	tag: string;
	href?: string;
	replyPlaceholder?: string;
}
interface Bridge {
	notify?: (n: ShellNotification) => void;
	onNotification?: (
		cb: (payload: { tag: string; href?: string; reply?: string }) => void,
	) => void;
}
const bridge = () => (globalThis as { wattroom?: Bridge }).wattroom;
const inShell = () => typeof bridge()?.notify === 'function';

function stored(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}
function store(value: string) {
	try {
		localStorage.setItem(KEY, value);
	} catch {
		/* no storage: the choice lasts this page load */
	}
}
const granted = () =>
	typeof Notification !== 'undefined' && Notification.permission === 'granted';

let enabled = $state(
	inShell() ? stored() !== '0' : stored() === '1' && granted(),
);

/** How a notification answers back: the placeholder, and where the text goes. */
export interface ReplyTo {
	placeholder: string;
	send: (text: string) => Promise<unknown> | unknown;
}
const replies = new Map<string, ReplyTo['send']>();
let navigate: (href: string) => void = () => {};

/** Nobody is looking at this window: hidden, or not the front one. */
export function away(): boolean {
	return document.hidden || !document.hasFocus();
}

export const notify = {
	get enabled() {
		return enabled;
	},
	get supported() {
		return inShell() || typeof Notification !== 'undefined';
	},
	/**
	 * In a browser, call from a click — the permission prompt needs the
	 * gesture. Answers with the browser's verdict, so a switch can say
	 * "blocked" instead of offering the same click again (#1330's audit).
	 */
	async enable(): Promise<'granted' | 'denied' | 'default' | 'shell'> {
		if (inShell()) {
			enabled = true;
			store('1');
			return 'shell';
		}
		if (typeof Notification === 'undefined') return 'denied';
		const verdict = await Notification.requestPermission();
		enabled = verdict === 'granted';
		if (enabled) store('1');
		return verdict;
	},
	/** The browser's standing answer, without asking: 'denied' once blocked. */
	get permission(): 'granted' | 'denied' | 'default' | 'unsupported' {
		if (inShell()) return 'granted';
		return typeof Notification === 'undefined'
			? 'unsupported'
			: Notification.permission;
	},
	disable() {
		enabled = false;
		store('0');
	},
	/**
	 * Fires only when enabled AND nobody is looking — never over the open
	 * app. `href` is where a click lands; `reply` gives the shell's
	 * notification its answer field.
	 */
	push(
		title: string,
		body: string,
		tag: string,
		opts: { href?: string; reply?: ReplyTo } = {},
	) {
		if (!enabled || typeof document === 'undefined' || !away()) return;
		if (opts.reply) replies.set(tag, opts.reply.send);
		else replies.delete(tag);
		const shell = bridge();
		if (shell?.notify) {
			shell.notify({
				title,
				body,
				tag,
				href: opts.href,
				replyPlaceholder: opts.reply?.placeholder,
			});
			return;
		}
		try {
			// tag dedupes a burst into one notification per stream.
			const n = new Notification(title, { body, tag });
			n.onclick = () => {
				window.focus();
				if (opts.href) navigate(opts.href);
				n.close();
			};
		} catch {
			/* a refused notification is not an error worth surfacing */
		}
	},
	/**
	 * Once, from the layout: how to navigate, and the shell's clicks and
	 * replies coming back. A reply goes to whoever pushed the notification;
	 * a click goes to its href.
	 */
	listen(go: (href: string) => void) {
		navigate = go;
		bridge()?.onNotification?.(({ tag, href, reply }) => {
			if (reply) void replies.get(tag)?.(reply);
			else if (href) navigate(href);
		});
	},
};
