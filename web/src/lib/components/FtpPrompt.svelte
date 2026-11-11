<script lang="ts">
	import { RaceWeightConfirmDays } from '#lib/protocol.ts';
	import { confirmWeight } from '#lib/profile-sync.svelte.ts';
	import { toasts } from '#lib/toast.svelte.ts';

	let {
		current,
		suggested,
		best20,
		weightKg,
		onApply,
		onKeep,
	}: {
		current: number;
		/** The FTP the curve suggests; absent when only the weight asks. */
		suggested?: number | null;
		best20: number;
		/** Set when the commissaire's tap is due (`me.weightConfirmDue`). */
		weightKg?: number | null;
		onApply?: () => void;
		onKeep?: () => void;
	} = $props();

	const gain = $derived(
		suggested ? Math.round(((suggested - current) / current) * 100) : 0,
	);

	// The commissaire's tap (ADR-0067, #3629): the answer refreshes `me`, whose
	// weightConfirmDue then drops this row, so the toast is what says it took.
	let busy = $state(false);
	let error = $state<string | null>(null);
	async function confirm() {
		busy = true;
		error = await confirmWeight();
		busy = false;
		if (!error) toasts.push('Weight confirmed. The next race places you.');
	}
</script>

<!--
	docs/SPEC.md: prompt when 90-day 0.95 × best-20-min exceeds the set FTP by >2 %.
	Never auto-apply — FTP moves the difficulty of every workout you own.
-->
<div class="border-neon/40 bg-surface-raised rounded-lg border p-5">
	{#if suggested}
		<p class="font-display font-bold">Your FTP looks low</p>
		<p class="text-muted mt-1.5 text-xs leading-relaxed">
			Your best 20 minutes in the last 90 days is {best20} W, which puts your FTP
			around
			<span class="text-ink">{suggested} W</span> — {gain}% above the {current} W
			you have set. Raising it makes every workout harder, so it's your call.
		</p>
		<div class="mt-4 flex gap-2">
			<button onclick={onApply} class="btn btn-primary"
				>Set FTP to {suggested} W</button
			>
			<button onclick={onKeep} class="btn btn-secondary"
				>Keep {current} W</button
			>
		</div>
	{/if}
	{#if weightKg}
		<div class={suggested ? 'border-edge mt-5 border-t pt-5' : ''}>
			<p class="font-display font-bold">Confirm your race weight</p>
			<p class="text-muted mt-1.5 text-xs leading-relaxed">
				A race places you on a weight confirmed in the last {RaceWeightConfirmDays}
				days. If yours has changed, save the new one instead.
			</p>
			<div class="mt-4 flex flex-wrap items-center gap-3">
				<button onclick={confirm} disabled={busy} class="btn btn-secondary"
					>Still {weightKg} kg? That's right</button
				>
				{#if error}
					<p class="text-danger text-xs" role="alert">{error}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
