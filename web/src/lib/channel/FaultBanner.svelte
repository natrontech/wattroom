<script lang="ts">
	import { faultCopy } from '$lib/channel/fault-copy';
	import type { Fault } from '$lib/channel/types';

	let {
		fault,
		bufferedSeconds,
		onRecover,
		note,
	}: {
		fault: Fault;
		/** Riding this device holds for the channel; absent when no ride runs. */
		bufferedSeconds?: number;
		onRecover: () => void;
		/** One more line the channel knows and the fault does not (#1590). */
		note?: string;
	} = $props();

	const copy = $derived(faultCopy(fault, bufferedSeconds));

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
<!-- A lost trainer or channel is an alert, not a status (#2179): "reconnecting"
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
