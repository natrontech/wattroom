import { beforeNavigate, goto } from '$app/navigation';
import { confirm } from '$lib/confirm.svelte';

/**
 * A stray tap on the rail mid-effort must not eat the effort (#126): one
 * confirm, only while `live()` says the session is alive, plus the browser's
 * own unload guard for a closed tab. Lifted out of /ride because /ramp had
 * none — a back gesture at minute 14 of a maximal test lost the number
 * (audit 2026-09-09). Call during component init, like beforeNavigate.
 */
export function guardLeaving(
	live: () => boolean,
	ask: { title: string; body: string; action: string; cancel: string },
): void {
	// The guard must cancel synchronously and the dialog answers later, so a
	// "yes" re-issues the navigation with the guard stood down.
	let leaving = false;
	beforeNavigate((navigation) => {
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
