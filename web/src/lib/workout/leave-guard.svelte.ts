import { beforeNavigate, goto } from '$app/navigation';
import { confirm, type ConfirmRequest } from '#lib/confirm.svelte.ts';

/**
 * Unsaved edits in the workout editor are not lost to a stray tap: one
 * confirm while `live()` says there is something to lose, plus the browser's
 * own unload guard for a closed tab. It once guarded rides (#126); no ride
 * uses it now, because navigation never ends a ride (ADR-0093, #4259). Call
 * during component init, like beforeNavigate.
 */
export function guardLeaving(live: () => boolean, ask: ConfirmRequest): void {
	// The guard must cancel synchronously and the dialog answers later, so a
	// "yes" re-issues the navigation with the guard stood down.
	let leaving = false;
	beforeNavigate((navigation) => {
		if (navigation.shallow && navigation.type === 'goto') return;
		if (!live() || navigation.type === 'leave' || leaving) return;
		navigation.cancel();
		void confirm(ask).then((ok) => {
			if (!ok || !navigation.to) return;
			leaving = true;
			void goto(navigation.to.url);
		});
	});
	$effect(() => {
		const handler = (event: BeforeUnloadEvent) => {
			if (live()) event.preventDefault();
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});
}
