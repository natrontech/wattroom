<script lang="ts">
	import { formatClock } from '$lib/format';
	import type { Fault } from '$lib/channel/types';

	let {
		fault,
		bufferedSeconds,
		onRecover,
		note,
	}: {
		fault: Fault;
		bufferedSeconds: number;
		onRecover: () => void;
		/** One more line the room knows and the fault does not (#1590). */
		note?: string;
	} = $props();

	// What went wrong, why it matters, what happens next — never "something went wrong".
	const copy = $derived.by(() => {
		if (fault.kind === 'trainer') {
			if (fault.state === 'no-power')
				return {
					title: 'Trainer is connected but sends no power',
					detail:
						'It reports over Bluetooth — cadence or speed — but never watts, so nothing here can score you. Pair a power meter as a sensor, or a trainer that measures power.',
					// The button opens the chooser, which is what this copy asks
					// for — "Reconnect" named the one thing that will not help
					// here, since the device is connected (#2161).
					action: 'Pair another device',
				};
			if (fault.state === 'silent')
				return {
					title: 'Trainer is connected but sending nothing',
					detail:
						'No data has arrived over Bluetooth. Spin the cranks to wake it — and close anything else holding the trainer (Zwift, the Wahoo app, another tab), since it only accepts one connection.',
				};
			return fault.state === 'reconnecting'
				? {
						title: 'Trainer disconnected',
						detail:
							'Reconnecting over Bluetooth. Keep pedalling — your ride is still recording.',
					}
				: {
						title: "Trainer didn't come back",
						detail:
							'Bluetooth dropped and three retries failed. Wake the trainer (spin the cranks) and reconnect.',
					};
		}
		if (fault.kind === 'voice') {
			return fault.state === 'reconnecting'
				? {
						title: 'Voice dropped',
						detail:
							'Reconnecting the call — the room may not hear you right now. Your ride and metrics are unaffected.',
					}
				: {
						title: "Voice didn't come back",
						detail:
							'The call could not reconnect. Your ride is unaffected — rejoin voice when you are ready.',
					};
		}
		if (fault.kind === 'mic') {
			return {
				title: 'Your microphone stopped',
				detail:
					'The browser lost the microphone — a headset unplugged, Bluetooth switching to its phone profile, or another app taking it. The room hears nothing from you; your ride is unaffected. Plug it back in and reconnect.',
			};
		}
		if (fault.state === 'offline')
			return {
				title: 'Your connection dropped',
				detail: `This device is offline, so the room can't hear from you. It rejoins by itself the moment your network is back — ${formatClock(bufferedSeconds)} of riding is stored here until then.`,
			};
		return fault.state === 'reconnecting'
			? {
					title: 'Lost the room',
					detail: `Reconnecting. ${formatClock(bufferedSeconds)} of riding is buffered on this device and will be sent when you're back.`,
				}
			: {
					title: "Still can't reach the room",
					detail: `Retrying every 10 seconds — or reconnect now if your network just came back. Your ride is safe: ${formatClock(bufferedSeconds)} is stored locally and uploads on reconnect. Voice and the shared timeline are offline.`,
				};
	});

	// Offline recovers by itself too, on the network's return — and a
	// Reconnect button with no network would only fail (errors.md).
	const recovering = $derived(
		fault.state === 'reconnecting' || fault.state === 'offline',
	);
</script>

<!--
	.claude/rules/errors.md: ride-critical failures are persistent dashboard status,
	never a transient toast. Recovery is automatic where it can be; the manual path
	is one big button, because the rider is sweating three metres away.
-->
<!-- A lost trainer or room is an alert, not a status (#2179): "reconnecting"
     is progress and waits its turn politely; "the trainer is gone, here is the
     button" is the one thing a rider on a bike needs read out now. Banner
     already splits the two by tone. -->
<div
	class="flex flex-wrap items-center gap-4 rounded-lg border px-5 py-3 {recovering
		? 'border-z5/40 bg-z5/10'
		: 'border-danger/50 bg-danger/10'}"
	role={recovering ? 'status' : 'alert'}
	aria-live={recovering ? 'polite' : 'assertive'}
>
	<span
		class="h-2.5 w-2.5 shrink-0 rounded-full {recovering
			? 'bg-z5 motion-safe:animate-pulse'
			: 'bg-danger'}"
	></span>
	<div class="min-w-0">
		<p class="text-sm font-medium">{copy.title}</p>
		<p class="text-muted text-xs">{copy.detail}</p>
		{#if note}<p class="text-xs">{note}</p>{/if}
	</div>
	{#if !recovering}
		<!-- Its own row at phone width (#1628): beside 200 characters of
		     copy it left the words 140 px. -->
		<button
			onclick={onRecover}
			class="btn btn-primary btn-lg ml-auto shrink-0 max-sm:ml-0 max-sm:w-full"
			>{copy.action ?? 'Reconnect'}</button
		>
	{/if}
</div>
