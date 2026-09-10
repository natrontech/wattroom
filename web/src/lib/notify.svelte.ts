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
import { toasts } from '$lib/toast.svelte';
const KEY = 'wattroom.notify.v1'; // '1' on, '0' off; the shell's default is on
const OFFER_KEY = 'wattroom.notify-offer.v1'; // 'no' once waved away

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

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* no storage: the choice lasts this page load */
	}
}
const stored = () => read(KEY);
const store = (value: string) => write(KEY, value);
const granted = () =>
	typeof Notification !== 'undefined' && Notification.permission === 'granted';

let enabled = $state(
	inShell() ? stored() !== '0' : stored() === '1' && granted(),
);

// The in-context offer (#1485), remembered where the switch it flips is
// remembered: per device. A notification permission belongs to one browser,
// so a rider who said no here and rides from a second machine is a rider who
// has not been asked on that one — an account column would call that asked
// and never offer again.
let offerWaved = $state(read(OFFER_KEY) === 'no');

/** How a notification answers back: the placeholder, and where the text goes. */
export interface ReplyTo {
	placeholder: string;
	/**
	 * Sends the text. A STRING result is the refusal and is said out loud
	 * (#1815); anything else — null, a boolean, whatever the caller's own
	 * send returns — is success.
	 */
	send: (text: string) => Promise<unknown> | unknown;
}
const replies = new Map<string, ReplyTo['send']>();
let navigate: (href: string) => void = () => {};

/** Nobody is looking at this window: hidden, or not the front one. */
export function away(): boolean {
	return document.hidden || !document.hasFocus();
}

// A reply from the notification field, and its refusal (#1815): the promise
// used to be voided, so a reply refused — unfriended, too long, offline —
// vanished with nothing said. This is the one path a message could disappear
// on without a trace; now it is a toast that keeps the words and leads to
// the thread.
async function answer(tag: string, href: string | undefined, text: string) {
	const refusal = await replies.get(tag)?.(text);
	if (typeof refusal !== 'string') return;
	toasts.push(`Not sent — ${refusal} Your reply: “${text}”`, {
		tone: 'error',
		href,
	});
}

function send(
	title: string,
	body: string,
	tag: string,
	opts: { href?: string; reply?: ReplyTo },
) {
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
	 * Whether to offer notifications in context (#1485) — where a rider first
	 * sees a session planned in one of their rooms, the moment being told
	 * would matter. Only where the button can succeed: possible here, not
	 * already on, not blocked by this browser (it will never ask again), and
	 * not something the rider has switched off or waved away before. The
	 * shell's default of on is covered by `enabled`; a shell rider who
	 * switched it off stored '0' and is not asked again.
	 */
	get offered(): boolean {
		return (
			!offerWaved &&
			notify.supported &&
			!enabled &&
			notify.permission !== 'denied' &&
			stored() !== '0'
		);
	},
	/** Waved away, for good, on this device. */
	waveOffer() {
		offerWaved = true;
		write(OFFER_KEY, 'no');
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
		send(title, body, tag, opts);
	},
	/**
	 * One notification while the rider IS looking (#1440): the only way to
	 * see what one looks like without asking a friend to message you — and,
	 * in the shell, what puts the OS permission prompt in front of them now
	 * rather than the first time a message lands while they are elsewhere.
	 */
	test() {
		if (!enabled) return;
		send(
			'WattRoom',
			'Notifications work. A message, an arrival, a session starting or a poke reaches you like this while the app is behind another window.',
			'test',
			{ href: '/settings/notifications' },
		);
	},
	/**
	 * Once, from the layout: how to navigate, and the shell's clicks and
	 * replies coming back. A reply goes to whoever pushed the notification;
	 * a click goes to its href.
	 */
	listen(go: (href: string) => void) {
		navigate = go;
		bridge()?.onNotification?.(({ tag, href, reply }) => {
			if (reply) void answer(tag, href, reply);
			else if (href) navigate(href);
		});
	},
};
