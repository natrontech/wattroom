import { notify } from '$lib/notify.svelte';
import { shouldAnnounce } from '$lib/notify-once';
import { play } from '$lib/sound/cues';
import { toasts } from '$lib/toast.svelte';

/** A message arriving, from wherever it arrived. */
export interface Arrival {
	/** One key per stream — every path that can see this line passes the same one. */
	tag: string;
	/** The line's own timestamp: what makes announcing it twice impossible. */
	at: number;
	/** Who spoke, and where — "Ruben · Velvet Hammer". */
	title: string;
	/** What they said; an image-only line still said something. */
	body: string;
	/** Where the toast takes you. */
	href: string;
	/** The thread is open in front of the reader — it announces itself. */
	reading: boolean;
}

/**
 * A message announced once (#568). The room you are standing in, a room you
 * are not, a DM — all three come through here, so an arrival sounds and
 * looks the same wherever it came from, and two paths that both see the same
 * line cannot both announce it.
 */
export function announce(arrival: Arrival): void {
	if (arrival.reading || !shouldAnnounce(arrival.tag, arrival.at)) return;
	play('chat');
	// A hidden tab gets the OS notification, as it always has. A VISIBLE one
	// gets a toast: the rider is in the app looking at Training or a workout,
	// where a blip alone says something happened but never what or where.
	if (document.hidden) notify.push(arrival.title, arrival.body, arrival.tag);
	else
		toasts.push(
			arrival.body ? `${arrival.title}: ${arrival.body}` : arrival.title,
			{ href: arrival.href },
		);
}
