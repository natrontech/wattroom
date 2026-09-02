<script lang="ts">
	import { formatClock, type Fault } from '$lib/room/mockcompat';

	let {
		fault,
		bufferedSeconds,
		onRecover,
	}: { fault: Fault; bufferedSeconds: number; onRecover: () => void } =
		$props();

	// What went wrong, why it matters, what happens next — never "something went wrong".
	const copy = $derived.by(() => {
		if (fault.kind === 'trainer') {
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
		return fault.state === 'reconnecting'
			? {
					title: 'Lost the room',
					detail: `Reconnecting. ${formatClock(bufferedSeconds)} of riding is buffered on this device and will be sent when you're back.`,
				}
			: {
					title: "Couldn't rejoin the room",
					detail: `Your ride is safe — ${formatClock(bufferedSeconds)} is stored locally and uploads on reconnect. Voice and the shared timeline are offline.`,
				};
	});

	const recovering = $derived(fault.state === 'reconnecting');
</script>

<!--
	.claude/rules/errors.md: ride-critical failures are persistent dashboard status,
	never a transient toast. Recovery is automatic where it can be; the manual path
	is one big button, because the rider is sweating three metres away.
-->
<div
	class="flex items-center gap-4 rounded-lg border px-5 py-3 {recovering
		? 'border-z5/40 bg-z5/10'
		: 'border-danger/50 bg-danger/10'}"
	role="status"
	aria-live="polite"
>
	<span
		class="h-2.5 w-2.5 shrink-0 rounded-full {recovering
			? 'bg-z5 animate-pulse'
			: 'bg-danger'}"
	></span>
	<div class="min-w-0">
		<p class="text-sm font-medium">{copy.title}</p>
		<p class="text-muted text-xs">{copy.detail}</p>
	</div>
	{#if !recovering}
		<button onclick={onRecover} class="btn btn-primary btn-lg ml-auto shrink-0"
			>Reconnect</button
		>
	{/if}
</div>
