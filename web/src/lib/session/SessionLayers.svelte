<script module lang="ts">
	import { createSessionSetup } from '$lib/session/session-setup.svelte';

	/**
	 * What the shell opens over a voice channel for its session: TV mode and
	 * the picker. The shell's context flips these for the places, and its one
	 * Escape handler reads them to close the topmost layer first; the
	 * component below draws them.
	 */
	export function createSessionLayers() {
		let tv = $state(false);
		const setup = createSessionSetup();
		return {
			get tv() {
				return tv;
			},
			set tv(next: boolean) {
				tv = next;
			},
			/** The picker: open, intent, and the shelf it offers. */
			setup,
			openPicker(intent: 'start' | 'plan' = 'start') {
				setup.intent = intent;
				setup.open = true;
			},
		};
	}
</script>

<script lang="ts">
	import { account } from '$lib/account.svelte';
	import { useChannel } from '$lib/channel/context';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sessionPath } from '$lib/channel/address';
	import { liveSessionId } from '$lib/channel/tick-session';
	import { planDue, startCrewPlan, startedPath } from '$lib/crew-schedule';
	import { device } from '$lib/device.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { flatten } from '$lib/workout/engine';
	import type { Workout, Segment } from '$lib/workout/types';
	import type { SessionState } from '$lib/protocol';
	import Modal from '$lib/components/Modal.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import ChannelStatus from '$lib/channel/ChannelStatus.svelte';
	import type { channelConnection } from '$lib/channel/connection.svelte';
	import type { ChannelShellProps } from '$lib/channel/context-value.svelte';
	import type { createRiders } from '$lib/channel/riders.svelte';
	import type { Phase } from '$lib/channel/types';
	import SessionPicker from '$lib/session/SessionPicker.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { needsTrainer } from '$lib/session/sensor-status';
	import TvOverlay from '$lib/session/TvOverlay.svelte';
	import { createSummary } from '$lib/session/summary.svelte';

	// The session's own layers over the live shell (#686's seams, one more):
	// TV mode, the picker and the summary at its close, with the pick → start
	// hand-off they share. The shell keeps the connection and the roster;
	// these only read them.

	let {
		layers,
		connection,
		roster,
		shared,
		segments,
		phase,
		placeName,
		code,
		onSchedule,
	}: {
		layers: ReturnType<typeof createSessionLayers>;
		connection: ReturnType<typeof channelConnection.join>;
		roster: ReturnType<typeof createRiders>;
		shared: SessionState | undefined;
		segments: Segment[];
		phase: Phase;
		placeName: string;
		code?: string;
		onSchedule: ChannelShellProps['onSchedule'];
	} = $props();

	const live = $derived(connection.live);
	// The picker asks for a trainer before Start while there is none (#2594).
	const unpaired = $derived(
		needsTrainer(connection.ride.trainer, live.pairing),
	);
	const riders = $derived(roster.riders);
	const you = $derived(roster.you);
	// A plan on its way holds the picker (#2609): each POST is a plan and a
	// mail to every member, so a second tap before the first answers was a
	// duplicate on the calendar and in everyone's inbox.
	let planning = $state(false);

	// ── Composed, not owned (code-quality.md): the summary that reads the
	// recording and the roster — each its own module, wired here to the
	// connection. ─────────────────────────────────────────────────────────────
	// The shell joins one connection per mount and never swaps it, so its
	// recording is this layer's for as long as the layer is.
	// svelte-ignore state_referenced_locally
	const summary = createSummary({
		recording: connection.recording,
		phase: () => shared?.phase,
		startedAt: () =>
			live.tick ? live.tick.at - live.tick.state.elapsed * 1000 : undefined,
		myName: () => account.me?.displayName,
		myId: () => account.me?.id,
		myExecution: () => you.execution,
		sessionId: () => shared?.id,
		workoutName: () => shared?.workoutName,
		riders: () => riders,
		ftp: () => you.ftp,
	});
	// The close is read on the summary (#2601): TV mode drew over it, and its
	// "Exit TV mode (esc)" dismissed a summary nobody had seen. TV steps aside
	// the moment there is one to read.
	$effect(() => {
		if (summary.card) layers.tv = false;
	});

	// ── Coach controls ────────────────────────────────────────────────────────
	const channel = useChannel();
	function startWorkout(picked: Workout) {
		// The workout this channel has planned, now (#2606): started through
		// the plan, as its card and the Schedule start it, so it is marked and
		// stops offering itself — a bare pick left it listed for its grace and
		// the Schedule's Start now refused against the session it became.
		const plan = channel.plan;
		if (plan && plan.workoutName === picked.name && planDue(plan.startsAt)) {
			layers.setup.open = false;
			void startCrewPlan(channel.address.crew, plan.id).then((res) => {
				channel.reloadPlan();
				if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
				else void goto(startedPath(channel.address.crew, res.data), GO);
			});
			return;
		}
		const flat = flatten(picked);
		const total = flat.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		live.control('pick', {
			name: picked.name,
			json: JSON.stringify(picked),
			totalSeconds: total,
		});
		// start follows the tick that shows the pick landed (#1764): sent
		// blind, a refused pick's reason was overwritten by start's own
		// refusal, and a refused pick after a good one started the old one.
		startAfterPick = picked.name;
		following = true;
		layers.setup.open = false;
	}

	// The tab that pressed Start goes where the ride is (#2599): the session's
	// own address, once the tick names it — the count-in happens there, and
	// the voice channel's lobby left the coach looking at camera tiles while
	// the timeline started without them. Only this tab, and only its own
	// start: a refusal lets go, and nobody else's start moves anyone.
	const GO = { keepFocus: true, noScroll: true };
	let following = $state(false);
	$effect(() => {
		const id = liveSessionId(live.tick?.state);
		if (!following || !id) return;
		following = false;
		const to = sessionPath(channel.address.crew, id);
		if (page.url.pathname !== to) void goto(to, GO);
	});
	let startAfterPick = $state<string | null>(null);
	$effect(() => {
		const state = live.tick?.state;
		if (!startAfterPick || !state) return;
		if (state.phase === 'idle' && state.workoutName === startAfterPick) {
			startAfterPick = null;
			live.control('start');
		}
	});
	$effect(() => {
		if (!live.refusal) return;
		startAfterPick = null;
		following = false;
	});
</script>

{#if layers.tv}
	<TvOverlay
		{riders}
		{segments}
		total={shared?.totalSeconds ?? 0}
		elapsed={shared?.elapsed ?? 0}
		block={roster.block}
		{placeName}
		{code}
		live={phase === 'live'}
		workoutName={shared?.workoutName ?? ''}
		playing={!!live.tick?.jukebox?.current}
		sprint={live.tick?.sprint ?? connection.ride.blockSprint}
		game={live.tick?.game ?? null}
		countdown={phase === 'countdown'
			? {
					remaining: shared?.countdownRemaining ?? 0,
					title: shared?.workoutName ?? '',
				}
			: undefined}
		onExit={() => (layers.tv = false)}
	>
		{#snippet status()}
			<ChannelStatus />
		{/snippet}
	</TvOverlay>
{/if}

{#if layers.setup.open}
	<SessionPicker
		shelf={layers.setup.shelf}
		shelfError={layers.setup.custom.error}
		onRetryShelf={() => void layers.setup.custom.retry()}
		intent={layers.setup.intent}
		ftp={connection.profile.current.ftp}
		gameRunning={!!live.tick?.game}
		busy={planning}
		onPlan={async (name, json, at) => {
			if (planning) return;
			planning = true;
			try {
				// Closed only once the server took it (#1766): a refused time used
				// to leave a toast and a closed picker — the workout and the time
				// to choose again. The refusal is the toast the channel already shows.
				if ((await onSchedule(name, json, at)) !== false)
					layers.setup.open = false;
			} finally {
				planning = false;
			}
		}}
		onStart={device.spectator
			? // A phone plans, and does not start (#1767). The Sessions place
				// opens this picker on a spectator device now, and the picker
				// already has the shape for one that only plans — an absent
				// `onStart` — so the gate lands here rather than as a second
				// branch inside it, taking the "Start it now instead" flip with
				// it. Starting belongs to the screen the coach rides on, which
				// is the gate SessionControls wears.
				undefined
			: (workout) => startWorkout(workout)}
		onStartGame={device.spectator
			? // A game IS a session, started the same way.
				undefined
			: (id) => {
					live.control('game', undefined, id);
					following = true;
					layers.setup.open = false;
				}}
		trainer={unpaired ? trainerCard : undefined}
		onClose={() => (layers.setup.open = false)}
	/>
{/if}

{#snippet trainerCard()}<TrainerOverview compact />{/snippet}

{#if summary.card}
	{@const card = summary.card}
	<!-- The summary has to call out (#359). It used to render at the bottom of
	     the main column, so a session ended while you were looking at the stage
	     and nothing said so — a modal is the session telling you it is over.
	     It draws the close, not the live values (#2603): the coach's next pick
	     turned the phase back to idle and took everyone's summary with it. -->
	<Modal
		label="Session summary"
		class="max-w-5xl"
		onclose={() => summary.dismiss()}
	>
		<SessionSummary
			subtitle="{placeName} · {card.workoutName} · {new Date().toLocaleDateString()}"
			samples={card.samples}
			ftp={card.ftp}
			execution={card.execution}
			medal={summary.medal}
			{placeName}
			riders={card.riders}
		>
			{#snippet actions()}
				<div class="flex flex-wrap gap-2">
					<!-- The end links forward (#1331): the ride the session saved for
					     you, found by the session it belongs to once the save lands.
					     Following it is done with the summary: coming back to the
					     channel must not open it again. -->
					{#if summary.rideId}
						<a
							href="/history/{summary.rideId}"
							onclick={() => summary.dismiss()}
							class="btn btn-primary">See your ride</a
						>
					{/if}
					<!-- The page is already the channel's under it (#2600): the
					     session's address lets go when it ends. -->
					<button onclick={() => summary.dismiss()} class="btn btn-secondary"
						>Back to {placeName}</button
					>
				</div>
			{/snippet}
		</SessionSummary>
	</Modal>
{/if}
