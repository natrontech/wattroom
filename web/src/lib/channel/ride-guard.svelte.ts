import { beforeNavigate, goto } from '$app/navigation';
import { channelOfPath } from '$lib/channel/address';
import { channelConnection } from '$lib/channel/connection.svelte';
import { confirm } from '$lib/confirm.svelte';
import { crewLive } from '$lib/nav/crew-live.svelte';

/**
 * A ride in one voice channel is not ended by a stray tap on another (#2602).
 * Opening a different voice channel's page or session joins it, which leaves
 * this one: the call hangs up, the trainer is let go at target 0, and the
 * summary is lost. So while this tab rides — a live session or a free ride,
 * on a trainer (#2843) — that one navigation asks first, as /ride and /ramp's leave guard does
 * (ADR-0046's parity rule). Everything else keeps the ride running and
 * passes: the crew's pages, You, a text channel. The Leave button stays
 * immediate (errors.md: the rider asked for exactly that). Call during the
 * root layout's init.
 */
export function guardTheRide(): void {
	// The guard cancels synchronously and the dialog answers later, so a
	// "yes" re-issues the navigation with the guard stood down.
	let leaving = false;
	beforeNavigate((navigation) => {
		const here = channelConnection.current;
		const to = navigation.to?.url;
		if (leaving || navigation.type === 'leave' || !here || !to) return;
		if (!here.riding() || !here.ride.trainer) return;
		const next = channelOfPath(
			to.pathname,
			(crew, id) =>
				crewLive.crew(crew)?.channels.find((c) => c.session?.id === id)?.id,
		);
		if (!next || next === here.address.channel) return;
		navigation.cancel();
		// A free ride is saved on the way out (connection.leave), a session's
		// ride is not — so the two say different things (#2843). A free ride
		// can run beside a session the rider has not joined.
		void confirm(
			!here.freeRide.recording
				? {
						title: `Leave the session in ${here.address.name}?`,
						body: 'Your ride there stops, you leave its call, and your trainer lets go.',
						action: 'Leave the session',
						cancel: 'Keep riding',
					}
				: {
						title: `End your free ride in ${here.address.name}?`,
						body: 'Opening another voice channel leaves this one: your ride ends and is saved, you leave its call, and your trainer lets go.',
						action: 'End the ride',
						cancel: 'Keep riding',
					},
		).then((ok) => {
			if (!ok) return;
			leaving = true;
			void goto(to).finally(() => (leaving = false));
		});
	});
}
