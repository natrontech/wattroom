<script module lang="ts">
	import type { PairState } from '$lib/room/sensor-status';

	/**
	 * The trainer card's view-model, injected by whoever owns the trainer.
	 *
	 * Two owners, and they are not alike (#611): a room holds its connection
	 * for as long as you stand in it (`RoomSensorOverview`), while the solo
	 * one holds a trainer paired but not yet ridden
	 * (`lib/ride/solo-trainer.svelte.ts`). Both live above the router, and so
	 * do the three read-only sensors below the trainer — those are the same
	 * singleton on every screen, so they stay wired inside this component.
	 */
	export interface TrainerSlot {
		state: PairState;
		device?: string;
		/** Live watts and cadence — the honest confirmation, not just a name. */
		reading?: string;
		/** One line under the reading when it is paired but not well (#520). */
		hint?: string;
		/** Why the last pair attempt failed; shown under the grid. */
		error?: string | null;
		onPair: () => void;
		onForget: () => void;
		/** A simulated trainer, when the caller is allowed to offer one (#123). */
		onSimulate?: () => void;
	}
</script>

<script lang="ts">
	// The one sensor card, everywhere a rider asks "is my trainer connected?"
	// (#1000). It used to be three components — this grid, `TrainerButton`'s
	// bare buttons in a running session, and `DeviceSlot`'s rows on /settings/equipment, the
	// last of which could not pair a trainer at all. Same state machine
	// underneath all three (`sensor-status.ts`); only the drawing had forked,
	// so only the drawing was merged.
	//
	// Two layouts, one card: the full grid a rider gets set up in (#606's
	// "Paired Devices" shape), and `compact` — the trainer alone, thumb-sized,
	// for a running session's header where the grid does not fit.
	import { device } from '$lib/device.svelte';
	import type { SensorKind } from '$lib/ble/sensor';
	import { cardView } from '$lib/room/sensor-card';
	import { sensorReading, sensorState } from '$lib/room/sensor-status';
	import { sensors } from '$lib/sensors.svelte';
	import Bike from '@lucide/svelte/icons/bike';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Zap from '@lucide/svelte/icons/zap';

	let {
		trainer,
		elsewhere = {},
		compact = false,
	}: {
		trainer: TrainerSlot;
		/**
		 * Kinds one of the rider's OTHER screens holds, as the phrase naming
		 * it — "on your phone" (#610). A card with one shows that instead of
		 * a pair button: the hub grants one screen per sensor and would
		 * refuse a second. Empty on the solo pre-ride screens, which hold no
		 * room socket and so have nothing to arbitrate.
		 */
		elsewhere?: Record<string, string>;
		/** The trainer alone, as one row — a running session's header (#412). */
		compact?: boolean;
	} = $props();

	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	const SENSORS: { kind: SensorKind; label: string; icon: typeof Zap }[] = [
		{ kind: 'heart-rate', label: 'Heart rate', icon: HeartPulse },
		{ kind: 'power-meter', label: 'Power meter', icon: Zap },
		{ kind: 'cadence', label: 'Cadence', icon: RotateCw },
	];

	const BUTTON: Record<string, string> = {
		primary: 'btn btn-primary btn-xs',
		secondary: 'btn btn-secondary btn-xs',
		forget:
			'border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs',
	};

	const trainerView = $derived(
		cardView({
			state: trainer.state,
			supported,
			elsewhere: elsewhere.trainer,
			hint: trainer.hint,
		}),
	);
</script>

{#snippet card(args: {
	label: string;
	icon: typeof Zap;
	required: boolean;
	state: PairState;
	device?: string;
	reading?: string;
	hint?: string;
	/** Held by another of the rider's screens: the phrase naming it (#610). */
	elsewhere?: string;
	onPair: () => void;
	onForget: () => void;
})}
	{@const view = cardView({
		state: args.state,
		supported,
		elsewhere: args.elsewhere,
		hint: args.hint,
	})}
	<div
		class="panel flex min-w-0 flex-col items-center gap-2 px-4 py-5 text-center"
	>
		<args.icon
			size={28}
			class={view.shape === 'live' ? 'text-z4' : 'text-muted'}
			opacity={view.instead ? 0.5 : 1}
		/>
		<div class="min-w-0">
			<p class="font-display text-sm font-bold">
				{args.label}
				{#if !args.required}<span class="eyebrow ml-1">optional</span>{/if}
			</p>
			{#if view.shape === 'live'}
				<p class="mt-0.5 truncate text-xs">{args.device}</p>
				{#if args.reading}
					<p class="font-display text-watt text-sm font-bold tabular-nums">
						{args.reading}
					</p>
				{/if}
				{#if view.note}
					<p class="text-danger mt-0.5 text-[11px]">{view.note}</p>
				{/if}
			{:else}
				<p
					class="mt-0.5 text-xs {view.tone === 'danger'
						? 'text-danger'
						: 'text-muted'}"
				>
					{view.note}
				</p>
			{/if}
		</div>
		{#if view.button}
			<button
				onclick={view.button.variant === 'forget' ? args.onForget : args.onPair}
				class={BUTTON[view.button.variant]}>{view.button.label}</button
			>
		{:else if view.instead}
			<!-- Nothing to press, and the reason why (ux.md: never a button that
			     will fail). -->
			<p class="text-muted text-[11px]">{view.instead}</p>
		{/if}
	</div>
{/snippet}

<!-- Phones are spectators (WATTROOM.md, locked) — there is no trainer to
     pair and no reason to draw the question (#412). Gated HERE rather than at
     each call site, so every surface inherits it. -->
{#if !device.spectator}
	{#if compact}
		<!-- A running session's header: the trainer alone, on one line. The
		     failure travels with the control rather than toasting past a rider
		     three metres away (errors.md). -->
		<div class="flex flex-wrap items-center gap-2">
			{#if trainerView.shape === 'live'}
				{#if trainerView.note}
					<!-- Paired but silent (#520). This is the surface a rider is on
					     while the session runs, so it is the one that most needs to
					     say a connected trainer is not actually working. -->
					<p class="text-danger text-xs">{trainerView.note}</p>
				{/if}
				<button onclick={trainer.onForget} class="btn btn-ghost btn-xs"
					>Unpair trainer</button
				>
			{:else if trainerView.button}
				<!-- "Pair trainer", not "Pair": the strip has no card around it to
				     say what is being paired. -->
				<!-- Riding size (ux.md): this is the strip a rider sees mid-session,
				     and re-pairing a dropped trainer is the one big button
				     errors.md asks for (#1412). The variant decides which button
				     this is — a reconnecting trainer offers the way out, and
				     wiring that to onPair opened the chooser instead (#1716). -->
				{#if trainerView.button.variant === 'forget'}
					<p class="text-danger text-xs">{trainerView.note}</p>
					<button onclick={trainer.onForget} class="btn btn-ghost btn-xs"
						>{trainerView.button.label} trainer</button
					>
				{:else}
					<button onclick={trainer.onPair} class="btn btn-secondary btn-lg"
						>{trainerView.button.variant === 'primary'
							? 'Pair trainer'
							: trainerView.button.label}</button
					>
				{/if}
				{#if trainer.onSimulate}
					<button onclick={trainer.onSimulate} class="btn btn-ghost btn-xs"
						>Ride simulated</button
					>
				{/if}
			{:else}
				<p class="text-muted text-xs">
					Trainer {trainerView.note.toLowerCase()}{trainerView.instead
						? ` — ${trainerView.instead.toLowerCase()}`
						: ''}
				</p>
			{/if}
			{#if trainer.error && trainer.state !== 'connecting'}
				<p class="text-danger text-xs">{trainer.error}</p>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{@render card({
				label: 'Trainer',
				icon: Bike,
				required: true,
				state: trainer.state,
				device: trainer.device,
				reading: trainer.state === 'connected' ? trainer.reading : undefined,
				hint: trainer.hint,
				elsewhere: elsewhere.trainer,
				onPair: trainer.onPair,
				onForget: trainer.onForget,
			})}
			{#each SENSORS as sensor (sensor.kind)}
				{@const slot = sensors.slot(sensor.kind)}
				{@render card({
					label: sensor.label,
					icon: sensor.icon,
					required: false,
					state: sensorState(sensor.kind),
					device: slot.name,
					reading: sensorReading(sensor.kind),
					elsewhere: elsewhere[sensor.kind],
					onPair: () => void sensors.pair(sensor.kind),
					onForget: () => void sensors.forget(sensor.kind),
				})}
			{/each}
		</div>
		{#if !supported}
			<!-- Each card already says "needs Chrome or Edge"; this is the part a
			     rider cannot guess — that waiting for Safari is not a plan. -->
			<p class="text-muted mt-2 text-xs">
				Web Bluetooth is Chrome or Edge, on desktop or Android. Safari has said
				it never will.
			</p>
		{/if}
		{#if trainer.error && trainer.state !== 'connecting'}
			<p class="text-danger mt-2 text-xs">{trainer.error}</p>
		{/if}
		{#if trainer.onSimulate && !elsewhere.trainer}
			<!-- Dev-only (#123): simulated watts in a live room would count for
			     medals, XP and streaks — the fairness layer takes no fakes. Gone
			     while another screen holds the trainer: the hub would take no
			     samples from this one anyway (#610). -->
			<button onclick={trainer.onSimulate} class="btn btn-ghost btn-xs mt-2"
				>Ride simulated</button
			>
		{/if}
	{/if}
{/if}
