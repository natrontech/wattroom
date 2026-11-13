<script lang="ts">
	// The coach's mid-ride controls (roles matrix): sprint, pause, resume,
	// end. RoomLive carried them in its header; the split into places lost
	// them, which left a coach with no way to end a session. They render in
	// the Lounge's action row and the Training header — the two places a
	// coach stands during a session — from one definition.
	//
	// Thumb-sized (ux.md): the one control you reach for at 160 bpm cannot be
	// a 12 px label — which is exactly why End asks first. A stray thumb on a
	// 44 px target ends the session for everyone in it, and there is no undo to
	// offer (errors.md's confirm exception), so it confirms the way the solo
	// ride does. Cancelling a countdown loses nothing and does not ask.
	import { account } from '#lib/account.svelte.ts';
	import { confirm } from '#lib/confirm.svelte.ts';
	import { device } from '#lib/device.svelte.ts';
	import { useChannel } from '#lib/channel/context.ts';
	import { leaveChannel } from '#lib/channel/leave.ts';
	import { controlsFor } from '#lib/session/controls.ts';
	import { sessionOpen } from '#lib/channel/tick-session.ts';
	import { cancelSession } from '#lib/session/cancel.ts';
	import { endGame } from '#lib/session/end-game.ts';
	import { showsStartLine } from '#lib/session/start-line.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import Modal from '#lib/components/Modal.svelte';
	import Crown from '@lucide/svelte/icons/crown';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Radio from '@lucide/svelte/icons/radio';
	import Square from '@lucide/svelte/icons/square';
	import Zap from '@lucide/svelte/icons/zap';
	import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
	import { tooltip } from '#lib/tooltip.svelte.ts';

	let { compact = false }: { compact?: boolean } = $props();

	const channel = useChannel();
	const phase = $derived(channel.shared?.phase);
	const running = $derived(phase === 'running');
	const paused = $derived(phase === 'paused');
	const idle = $derived(!phase || phase === 'idle' || phase === 'done');

	// A session picked and not yet counted in (#4562): its coach had no way
	// out of it, and it held the channel. Nothing has been ridden, so it
	// goes at once and without asking, as a stopped countdown does.
	const waiting = $derived(idle && sessionOpen(channel.shared));
	// With an Undo that opens it again (#4562): the cancel is reversible.
	const cancel = () => cancelSession(channel);

	async function endSession() {
		const n = channel.riders.filter((r) => r.inSession).length;
		const ok = await confirm({
			title: `End the session for ${n} rider${n === 1 ? '' : 's'}?`,
			body: 'The ride stops for everyone and cannot be resumed.',
			action: 'End the session',
			cancel: 'Keep riding',
		});
		if (ok) channel.control('end');
	}

	const view = $derived(
		controlsFor({
			state: channel.shared,
			canControl: channel.canControl,
			canManage: channel.canManage,
			spectator: device.spectator,
			me: account.me?.id,
		}),
	);
	const coachName = $derived(channel.shared?.coachName || 'the coach');
	// The start line says who starts the ride (#4504): no second wait here.
	const onLine = $derived(
		showsStartLine(channelConnection.at(channel.address)?.live.tick),
	);
	// An admin coaching from a phone reaches their own session here too.
	const whose = $derived(
		channel.shared?.coach === account.me?.id ? 'the' : `${coachName}'s`,
	);

	/** The crew's owner or an admin, over a session someone else holds
	 *  (#2598). The hub's one `end` covers both: it closes a session that
	 *  ran, and drops a pick that never started. Either way the cost is
	 *  paid by the coach and whoever rides, so it asks (errors.md). */
	async function endTheirs() {
		const pick = view === 'clear';
		const n = channel.riders.filter((r) => r.inSession).length;
		const ok = await confirm(
			pick
				? {
						title: `Cancel ${whose} session?`,
						body: `${channel.shared?.workoutName || 'A workout'} is picked here and was never started. Cancelling it frees the channel for another session.`,
						action: 'Cancel the session',
						cancel: 'Keep going',
					}
				: {
						title: `End ${whose} session for ${n} rider${n === 1 ? '' : 's'}?`,
						body: 'The ride stops for everyone and cannot be resumed.',
						action: 'End the session',
					},
		);
		if (ok) channel.control('end');
	}

	// Whoever the coach may hand the session to (#2636): the context's rule,
	// so this list and every person menu offer the same people. The button
	// is the visible way in — a menu is never the only one (ux.md).
	let handingOff = $state(false);
	const takers = $derived(
		channel.riders.flatMap((rider) => {
			const give = channel.handOffOf(rider.id, rider.name);
			return give ? [{ ...give, id: rider.id, riding: rider.riding }] : [];
		}),
	);
</script>

<!-- A phone is a spectator, and the roles matrix gives a spectator none of
     these (docs/SPEC.md): picking a workout, starting, pausing, arming a
     sprint and ending all belong to the device the coach is riding on. Gated
     with the pairing button, in one place each (#412). Every control here
     is used while pedalling, so the non-compact row is 44 px too (#1592). -->
{#if view === 'coach'}
	{#if channel.game}
		<!-- Ending a game must never depend on the game panel being drawn
		     (#1586): Team Relay never ends itself, and this used to be the
		     panel's button alone. -->
		<button
			onclick={() => void endGame(channel)}
			{@attach tooltip(compact ? 'End game' : null)}
			aria-label="end the game"
			class="btn btn-secondary ride-stage:ride-word {compact
				? 'h-11 w-11 p-0'
				: 'btn-lg'}"
			><Gamepad2 size={compact ? 18 : 15} />{#if !compact}End game{/if}</button
		>
	{/if}
	{#if idle && !channel.address.channel}
		<!-- A crew's own session holds one session (docs/SESSIONS.md): the
		     next one starts from the crew page, which leaving lands on. -->
		<button onclick={leaveChannel} class="btn btn-secondary btn-lg"
			>Back to the crew</button
		>
	{:else if waiting}
		<button
			onclick={cancel}
			data-ride-control="cancel"
			class="btn btn-danger {compact
				? 'btn-ride'
				: 'btn-lg ride-stage:ride-word'}"
			><Square size={13} /> Cancel session</button
		>
	{:else if idle}
		<!-- Riding size in the compact header too (#2886): a free rider turns
		     the ride into a session from here while pedalling. -->
		<button
			onclick={() => channel.openPicker()}
			aria-label="Start a session"
			title={compact ? 'Start a session' : undefined}
			data-ride-control="session"
			class="btn btn-accent {compact
				? 'btn-ride'
				: 'btn-lg ride-stage:ride-word'}"
			><Radio size={compact ? 18 : 15} />
			<!-- The ride's one row has no room for the word under 2xl: at
			     1280 px it pushed the last control off the bar (#4472). -->
			<span class={compact ? 'max-2xl:hidden' : ''}>Start a session</span
			></button
		>
	{:else if phase === 'countdown'}
		<button
			onclick={cancel}
			data-ride-control="cancel"
			class="btn btn-danger {compact
				? 'btn-ride'
				: 'btn-lg ride-stage:ride-word'}"
			><Square size={13} /> Cancel session</button
		>
	{:else}
		<!-- Two boxes (#4567): the bar keeps End on screen at every width, and
		     the coach's other controls go under its More when the row is short.
		     One box held all four, and a phone's bar cut End off. -->
		<div
			data-ride-control="coach"
			class="border-muted/20 flex gap-1 rounded border p-0.5 empty:hidden"
		>
			{#if running && !channel.game}
				<!-- Not in a game (#2597): it keeps its own clock and runs its
				     own sprints, and the hub refuses both.
				     Chrome, so the structural accent (ADR-0005: only live data
				     wears --color-watt; there is no chrome exception). The watts
				     the sprint produces are what glows. -->
				<button
					onclick={() => channel.control('sprint')}
					disabled={!!channel.sprint}
					{@attach tooltip(
						compact ? 'Sprint' : null,
						channel.sprint ? 'A sprint is already running' : null,
					)}
					aria-label="arm a sprint"
					class="text-ink hover:bg-neon/10 ride-stage:ride-word flex items-center justify-center gap-1.5 rounded text-sm disabled:opacity-40 {compact
						? 'h-11 w-11'
						: 'min-h-11 px-4'}"
					><Zap
						size={compact ? 18 : 14}
						class="text-neon"
					/>{#if !compact}Sprint{/if}</button
				>
				<button
					onclick={() => channel.control('pause')}
					{@attach tooltip(compact ? 'Pause' : null)}
					aria-label="pause the session"
					class="text-muted hover:text-ink ride-stage:ride-word flex items-center justify-center gap-1.5 rounded text-sm {compact
						? 'h-11 w-11'
						: 'min-h-11 px-4'}"
					><Pause size={compact ? 18 : 14} />{#if !compact}Pause{/if}</button
				>
			{:else if paused}
				<button
					onclick={() => channel.control('resume')}
					{@attach tooltip(compact ? 'Resume' : null)}
					aria-label="resume the session"
					class="hover:bg-surface-raised ride-stage:ride-word flex items-center justify-center gap-1.5 rounded text-sm {compact
						? 'h-11 w-11'
						: 'min-h-11 px-4'}"
					><Play size={compact ? 18 : 14} />{#if !compact}Resume{/if}</button
				>
			{/if}
			{#if takers.length > 0}
				<button
					onclick={() => (handingOff = true)}
					{@attach tooltip(compact ? 'Hand off' : null)}
					aria-label="hand the session off"
					class="text-muted hover:text-ink ride-stage:ride-word flex items-center justify-center gap-1.5 rounded text-sm {compact
						? 'h-11 w-11'
						: 'min-h-11 px-4'}"
					><Crown size={compact ? 18 : 14} />{#if !compact}Hand off{/if}</button
				>
			{/if}
		</div>
		<div
			data-ride-control="end"
			class="border-muted/20 flex gap-1 rounded border p-0.5"
		>
			<button
				onclick={endSession}
				{@attach tooltip(compact ? 'End the session' : null)}
				aria-label="end the session"
				class="text-danger hover:bg-danger/10 ride-stage:ride-word flex items-center justify-center gap-1.5 rounded text-sm {compact
					? 'h-11 w-11'
					: 'min-h-11 px-4'}"
				><Square size={compact ? 16 : 13} />{#if !compact}End{/if}</button
			>
		</div>
	{/if}
{:else if view === 'end' || view === 'clear'}
	<!-- End anyone's session (docs/SPEC.md roles, #2598): the crew's lever
	     over a session left running or a pick left behind, since one session
	     holds the channel. On a phone too — it needs nothing a phone lacks. -->
	<button
		onclick={endTheirs}
		class="btn btn-danger {compact
			? 'btn-ride'
			: 'btn-lg ride-stage:ride-word'}"
		><Square size={13} />
		{view === 'clear'
			? `Cancel ${whose} session`
			: `End ${whose} session`}</button
	>
{:else if view === 'held' && !compact && !onLine}
	<!-- In place of the Start a member no longer has: who holds the channel. -->
	<p class="text-muted ride-stage:ride-word text-sm">
		{coachName} is setting up a session here.
	</p>
{/if}

{#if handingOff && takers.length > 0}
	<Modal label="Hand the session off" onclose={() => (handingOff = false)}>
		<h2 class="font-display text-lg font-bold">Hand the session to…</h2>
		<p class="text-muted mt-1 text-sm">
			They get pause, sprint and end. You keep riding.
		</p>
		<ul class="mt-4 grid gap-2">
			{#each takers as taker (taker.id)}
				<li>
					<button
						onclick={() => {
							taker.onSelect();
							handingOff = false;
						}}
						class="btn btn-secondary btn-lg w-full justify-between"
						><span class="flex min-w-0 items-center gap-1.5"
							><span class="truncate">{taker.name}</span></span
						><span class="text-muted text-xs"
							>{taker.riding ? 'riding' : 'not riding'}</span
						></button
					>
				</li>
			{/each}
		</ul>
	</Modal>
{/if}
