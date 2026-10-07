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
	import FaultBanner from '$lib/channel/FaultBanner.svelte';
	import { faultCopy } from '$lib/channel/fault-copy';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { pairError } from '$lib/ble/pair-error';
	import type { createRideSession } from '$lib/workout/session.svelte';

	let {
		session,
		signalLost,
		noCrashSafety = false,
		note,
		line = false,
	}: {
		session: ReturnType<typeof createRideSession>;
		signalLost: boolean;
		/**
		 * The ride buffer would not open, so nothing is writing this ride
		 * down (#1466 finding 4). Status rather than silence because it is
		 * known before the first pedal stroke, and the rider can still act
		 * on it then — ADR-0052 rule 3.
		 */
		noCrashSafety?: boolean;
		/** What this ride adds while the trainer is quiet — the ramp's promise. */
		note?: string;
		/**
		 * Slot 1's one line over the world (TARGETS G3, #3668): the state
		 * that matters most, in words at the riding floor, with at most one
		 * ≥ 44 px recovery button — never a paragraph that pushes the band
		 * into the road.
		 */
		line?: boolean;
	} = $props();

	let repairing = $state(false);
	let repairError = $state<string | null>(null);
	const fault = $derived(
		signalLost
			? faultCopy({
					kind: 'trainer',
					state:
						session.trainerStatus === 'connected' ? 'silent' : 'reconnecting',
				})
			: null,
	);
	// Ride-critical first (errors.md), then the guard, then the missing copy.
	const held = $derived(
		fault
			? {
					text: repairError ?? fault.line ?? fault.title,
					alert: true,
					recover: fault.action,
				}
			: session.state === 'autopaused'
				? { text: 'Paused — you stopped pedalling' }
				: session.state === 'resuming'
					? { text: `Picking back up in ${session.resumeIn} — ease in` }
					: session.hrHoldLost
						? { text: 'Heart-rate hold waiting — no heart rate' }
						: session.spiralActive
							? { text: 'Spiral guard — spin back up to get the target back' }
							: noCrashSafety
								? { text: 'This browser keeps no copy of this ride' }
								: null,
	);

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

{#if line}
	{#if held}
		<div
			data-status-line
			class="flex min-w-0 items-center gap-4"
			role={'alert' in held ? 'alert' : 'status'}
		>
			<span
				class="size-2.5 shrink-0 rounded-full {'alert' in held
					? 'bg-danger'
					: 'bg-z5'}"
			></span>
			<p class="min-w-0 truncate text-2xl leading-7">{held.text}</p>
			{#if 'recover' in held}
				<button
					onclick={() => void repair()}
					disabled={repairing}
					class="btn btn-primary btn-lg shrink-0"
					>{repairing ? 'Pairing…' : (held.recover ?? 'Reconnect')}</button
				>
			{/if}
		</div>
	{/if}
{:else}
	{#if session.state === 'autopaused'}
		<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
			<p class="text-sm font-medium">Paused — you stopped pedalling</p>
			<p class="text-muted text-xs">
				Your targets are released and this time is excluded from your score.
				Start pedalling to pick up where you left off.
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
	{:else if session.hrHoldLost}
		<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
			<p class="text-sm font-medium">Heart-rate hold waiting — no heart rate</p>
			<p class="text-muted text-xs">
				Your watts stay where they are until your strap reads again. The hold
				never raises them without it.
			</p>
		</div>
	{:else if session.spiralActive}
		<div
			class="border-neon/40 bg-surface-raised mt-4 rounded-lg border px-5 py-3"
		>
			<p class="text-sm font-medium">Spiral guard</p>
			<p class="text-muted text-xs">
				Your cadence collapsed under the target, so it is released until you
				spin back up. This is deliberate, not a dropout.
			</p>
		</div>
	{/if}

	{#if signalLost}
		<!-- The session's banner, words and way back alike (#2881, ADR-0046):
	     manual recovery is one big button (errors.md), and picking the
	     trainer again carries the ride on with it. -->
		<div class="mt-4">
			<FaultBanner
				fault={{
					kind: 'trainer',
					state:
						session.trainerStatus === 'connected' ? 'silent' : 'reconnecting',
				}}
				onRecover={() => void repair()}
				busy={repairing}
				note={[session.trainerName, note].filter(Boolean).join(' — ')}
			/>
			{#if repairError}
				<p class="text-danger mt-2 text-xs">{repairError}</p>
			{/if}
		</div>
	{/if}

	<!-- No button: the rider cannot open the browser's storage from here, and
     naming what causes it is the whole of the way back. Warn rather than
     error — the ride itself records and saves; what is missing is the copy
     that survives a crash. -->
	{#if noCrashSafety}
		<div class="mt-4">
			<Banner tone="warn">
				<p>
					<span class="font-medium"
						>This browser is not keeping its own copy of this ride.</span
					>
					<span class="text-muted"
						>Storage would not open — a private window, or site data switched
						off. The ride records and saves when it finishes, but if the browser
						closes before then there will be nothing to recover.</span
					>
				</p>
			</Banner>
		</div>
	{/if}
{/if}
