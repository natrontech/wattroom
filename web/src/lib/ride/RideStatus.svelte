<script lang="ts">
	/**
	 * The ride's own status, persistent, never a toast (errors.md): your
	 * guard — paused, counting back in, released — and the trainer going
	 * quiet, with the one big button back (#1847). Lifted out of RidingScreen
	 * so /ramp draws the same (#1799, ADR-0046). The card reads the SESSION's
	 * trainer: the pairing slot let go of it at Start, and a card wired to
	 * the slot read "Not connected — Pair" for a trainer that was connected
	 * and reattaching, and paired a second one the ride never heard.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { pairError } from '$lib/ble/pair-error';
	import type { createRideSession } from '$lib/workout/session.svelte';

	let {
		session,
		signalLost,
		lost = 'Trainer signal lost — reconnecting. Keep pedalling; your targets resume the moment it is back.',
	}: {
		session: ReturnType<typeof createRideSession>;
		signalLost: boolean;
		/** What the banner says while the trainer is quiet. */
		lost?: string;
	} = $props();

	let repairing = $state(false);
	let repairError = $state<string | null>(null);
	async function repair() {
		repairing = true;
		repairError = null;
		const next = new FtmsTrainer();
		try {
			await next.connect();
			session.repair(next);
		} catch (cause) {
			repairError = pairError(cause);
		} finally {
			repairing = false;
		}
	}
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
		<!-- Manual recovery is one big button (errors.md): pick the trainer
		     again and the ride carries on with it. -->
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<span class="text-muted text-xs">
				{session.trainerName} —
				{#if session.trainerStatus === 'connected'}
					connected, but sending nothing
				{:else}
					reconnecting on its own
				{/if}
			</span>
			<button
				onclick={() => void repair()}
				disabled={repairing}
				class="btn btn-secondary btn-lg"
				>{repairing ? 'Pairing…' : 'Pair the trainer again'}</button
			>
		</div>
		{#if repairError}
			<p class="text-danger mt-2 text-xs">{repairError}</p>
		{/if}
	</div>
{/if}
