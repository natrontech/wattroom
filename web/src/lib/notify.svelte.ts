/**
 * Browser notifications (#202): room events reach a rider whose tab is in
 * the background — chat, arrivals, a session starting. Off until the rider
 * flips the switch (browsers demand the gesture anyway); notifications only
 * fire while the tab is hidden — a visible room speaks for itself.
 */
const KEY = 'wattroom.notify.v1';

let enabled = $state(false);
try {
	enabled =
		localStorage.getItem(KEY) === '1' &&
		typeof Notification !== 'undefined' &&
		Notification.permission === 'granted';
} catch {
	/* storage or Notification unavailable: stays off */
}

export const notify = {
	get enabled() {
		return enabled;
	},
	get supported() {
		return typeof Notification !== 'undefined';
	},
	/** Call from a click — the permission prompt needs the gesture. */
	async enable() {
		if (typeof Notification === 'undefined') return;
		const permission = await Notification.requestPermission();
		enabled = permission === 'granted';
		try {
			if (enabled) localStorage.setItem(KEY, '1');
		} catch {
			/* fine */
		}
	},
	disable() {
		enabled = false;
		try {
			localStorage.removeItem(KEY);
		} catch {
			/* fine */
		}
	},
	/** Fires only when enabled AND the tab is hidden — never over the open app. */
	push(title: string, body: string, tag: string) {
		if (!enabled || typeof document === 'undefined' || !document.hidden) return;
		try {
			// tag dedupes a burst into one notification per stream.
			new Notification(title, { body, tag });
		} catch {
			/* a refused notification is not an error worth surfacing */
		}
	},
};
