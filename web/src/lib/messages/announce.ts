import { away, notify, type ReplyTo } from '$lib/notify.svelte';
import { shouldAnnounce } from '$lib/notify-once';
import { play } from '$lib/sound/cues';
import { toasts } from '$lib/toast.svelte';

/**
 * What kind of thing arrived. Every path through here looks identical once
 * the line is built, which is exactly why the kind has to be carried: a rule
 * written as "while the phase is running" would silence a DM and, with it,
 * the session starting in another room — the notification ADR-0042 calls the
 * most valuable — because both are announced by this one function (#1743).
 */
export type ArrivalKind = 'dm' | 'chat' | 'friend' | 'session';

/** A message arriving, from wherever it arrived. */
export interface Arrival {
	/** Which of the four this is; only a DM moves off a riding screen. */
	kind: ArrivalKind;
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
	/** How to answer from the notification itself, where the shell offers it. */
	reply?: ReplyTo;
}

/**
 * A screen the rider is on a bike in front of. While one is registered it
 * gets first refusal on a DM: the room writes the line into its own timeline,
 * and a solo ride, which has no timeline, takes it and leaves it to the
 * unread badge that was already there. Returning false hands it back — off a
 * ride the toast is still the right answer.
 *
 * Registered by the screen rather than asked for by this module, because
 * "is a ride under way" is the room connection's and the ride session's
 * business and neither belongs in the notification path.
 */
export type RidingScreen = (arrival: Arrival) => boolean;

const ridingScreens = new Set<RidingScreen>();

/** Register a riding screen; the returned function unregisters it. */
export function divertDmsWhileRiding(screen: RidingScreen): () => void {
	ridingScreens.add(screen);
	return () => {
		ridingScreens.delete(screen);
	};
}

/** The first screen that takes the line wins; none, and it stays a toast. */
function divert(arrival: Arrival): boolean {
	for (const screen of ridingScreens) if (screen(arrival)) return true;
	return false;
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
	// A window nobody is looking at gets the OS notification — hidden, or
	// behind another app (ADR-0042). A VISIBLE, focused one gets a toast: the
	// rider is in the app looking at Training or a workout, where a blip
	// alone says something happened but never what or where.
	if (away())
		notify.push(arrival.title, arrival.body, arrival.tag, {
			href: arrival.href,
			reply: arrival.reply,
		});
	// Mid-ride, a DM is the only thing on the screen that moves and is not
	// data (#1743): ux.md's "persistent status, never a toast" is about
	// errors, and a DM is not one — but a toast over the numbers a rider is
	// holding is still the wrong shape for it. The cue above already said
	// something arrived; the badge and the room's timeline say what. Only a
	// DM: room chat is the room the rider is riding with, and a session
	// starting elsewhere is ADR-0042's whole point.
	else if (arrival.kind === 'dm' && divert(arrival)) return;
	else
		toasts.push(
			arrival.body ? `${arrival.title}: ${arrival.body}` : arrival.title,
			{ href: arrival.href },
		);
}
