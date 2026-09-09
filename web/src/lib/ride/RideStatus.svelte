<script lang="ts">
	/**
	 * The ride's own status, persistent, never a toast (errors.md): your
	 * guard — paused, counting back in, released — and the trainer going
	 * quiet. Lifted out of RidingScreen so /ramp draws the same four (#1799,
	 * ADR-0046): mid-ramp the resistance could vanish for ten seconds and the
	 * one screen whose number a rider keeps for a month said nothing.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import type { Snippet } from 'svelte';
	import type { createRideSession } from '$lib/workout/session.svelte';

	let {
		session,
		signalLost,
		lost = 'Trainer signal lost — reconnecting. Keep pedalling; your targets resume the moment it is back.',
		recover,
	}: {
		session: ReturnType<typeof createRideSession>;
		signalLost: boolean;
		/** What the banner says while the trainer is quiet. */
		lost?: string;
		/** The way back when it stays quiet — one big button (errors.md). */
		recover?: Snippet;
	} = $props();
</script>

{#if session.state === 'autopaused'}
	<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
		<p class="text-sm font-medium">Paused — you stopped pedalling</p>
		<p class="text-muted text-xs">
			Your targets are released and this time is excluded from your score. Start
			pedalling to pick up where you left off.
		</p>
	</div>
{:else if session.state === 'resuming'}
	<div
		class="border-neon/40 bg-surface-raised mt-4 flex items-center gap-4 rounded-lg border px-5 py-3"
	>
		<span
			class="text-watt glow-text-strong font-display text-3xl font-bold tabular-nums"
			>{session.resumeIn}</span
		>
		<p class="text-sm">Picking back up — ease in.</p>
	</div>
{:else if session.spiralActive}
	<div
		class="border-neon/40 bg-surface-raised mt-4 rounded-lg border px-5 py-3"
	>
		<p class="text-sm font-medium">Spiral guard</p>
		<p class="text-muted text-xs">
			Your cadence collapsed under the target, so it is released until you spin
			back up. This is deliberate, not a dropout.
		</p>
	</div>
{/if}

{#if signalLost}
	<div class="mt-4">
		<Banner tone="error">{lost}</Banner>
		{#if recover}
			<div class="mt-3">{@render recover()}</div>
		{/if}
	</div>
{/if}
