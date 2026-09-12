<script lang="ts">
	// Room-level status, ranked. It belongs to the shell rather than to a
	// place — a dropped connection is true on every one of them, and
	// errors.md wants it persistent rather than a toast a rider three metres
	// from the screen will never see.
	//
	// The ranking is the content: the connection outranks the rider's own
	// guard, which outranks the trainer, which outranks voice, because a ride
	// with no power is broken and a ride with no talking is not. Keeping the
	// chain in one file is what keeps that order readable (#686).
	//
	// Reads the connection rather than taking eight props: it is only ever
	// rendered inside the shell, which has already joined, and this is the
	// pattern the room's other components follow.
	import Banner from '$lib/components/Banner.svelte';
	import { device } from '$lib/device.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import { DISCONNECT_GRACE_SECONDS, ELIMINATION_MODES } from '$lib/room/modes';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { trainerForRoom } from '$lib/ride/solo-trainer.svelte';

	const connection = $derived(roomConnection.current);
	const live = $derived(connection?.live);
	const av = $derived(connection?.av);
	const rideCtl = $derived(connection?.ride);
	const shared = $derived(connection?.shared());

	// How long the buffer has been catching samples the room has not seen.
	// Its own state because nothing else needs it, and its own effect because
	// the drop has to be stamped when it happens, not when it is rendered.
	let droppedAt = $state<number | null>(null);
	$effect(() => {
		if (live?.status === 'reconnecting' && droppedAt === null)
			droppedAt = Date.now();
		if (live?.status === 'live') droppedAt = null;
	});
</script>

{#if connection && live && av && rideCtl}
	<!-- Room-level status belongs to the shell, not to a place: a dropped
	     connection is true on every one of them, and errors.md wants it
	     persistent rather than a toast the rider will not see. -->
	<!-- Reconnecting, not "not yet live": the first connect used to paint
	     "Lost the room" on every entry, which trains riders to ignore the one
	     banner that must not be ignored (#1411). -->
	{#if live.status === 'reconnecting'}
		{@const droppedFor = droppedAt
			? Math.round((Date.now() - droppedAt) / 1000)
			: 0}
		{@const game = live.tick?.game}
		<div class="shrink-0 px-5 pt-4">
			<!-- Past the backoff's settling point the banner turns to "lost" and
			     grows the one big button (#1500). It dials now; it never reloads,
			     which would drop the trainer's Bluetooth link mid-ride. -->
			<FaultBanner
				fault={{ kind: 'room', state: live.lost ? 'lost' : 'reconnecting' }}
				bufferedSeconds={droppedFor}
				onRecover={() => live.retry()}
				note={game?.phase === 'running' && ELIMINATION_MODES.has(game.mode)
					? `${Math.max(0, DISCONNECT_GRACE_SECONDS - droppedFor)} s of the game's disconnect grace left — your pedalling is buffered and counts when you're back.`
					: undefined}
			/>
		</div>
	{:else if rideCtl.guard !== 'running'}
		<!-- The rider's own guard, in a room (#788): the group timeline runs
		     on without them, so nothing else on screen says why their
		     target went to zero. Ranked above the trainer's own faults for
		     the same reason auto-pause outranks everything solo — it is the
		     thing that just happened. -->
		<div class="shrink-0 px-5 pt-4">
			<div
				role="status"
				class="border-neon/40 bg-surface-raised flex items-center gap-4 rounded-lg border px-5 py-3"
			>
				{#if rideCtl.guard === 'resuming'}
					<span
						class="text-watt glow-text-strong font-display text-3xl font-bold tabular-nums"
						>{rideCtl.guardResumeIn}</span
					>
					<p class="text-sm">Picking back up — ease in.</p>
				{:else}
					<p class="text-sm">
						<span class="font-medium">Paused — you stopped pedalling.</span>
						<span class="text-muted"
							>Your targets are released; the room rides on. Start pedalling to
							pick them back up.</span
						>
					</p>
				{/if}
			</div>
		</div>
	{:else if rideCtl.spiralActive}
		<!-- The spiral-of-death release (docs/SPEC.md), which solo explained
		     and the room did not (audit 2026-09-09): the trainer just let go
		     mid-block, and without this line that is a dropout. -->
		<div class="shrink-0 px-5 pt-4">
			<div
				role="status"
				class="border-neon/40 bg-surface-raised flex items-center gap-4 rounded-lg border px-5 py-3"
			>
				<p class="text-sm">
					<span class="font-medium"
						>Cadence collapsed — targets are off for a moment.</span
					>
					<span class="text-muted"
						>Spin back up; the resistance returns by itself. This is deliberate,
						not a dropout.</span
					>
				</p>
			</div>
		</div>
	{:else if rideCtl.fault}
		<!-- The trainer's own state, which the room never showed (#520): the
		     mock has simulated this banner since #39 and the product could
		     not reach it, so "Unpair trainer" was the only thing a rider
		     with no watts had to go on. Ranked above voice — a ride with no
		     power is broken; a ride with no talking is not. -->
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'trainer', state: rideCtl.fault }}
				bufferedSeconds={0}
				onRecover={() => {
					rideCtl.unpair();
					void rideCtl.ride(trainerForRoom());
				}}
			/>
		</div>
	{:else if av.status === 'reconnecting'}
		<!-- Media gapped while the SDK retries (#234). -->
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'voice', state: 'reconnecting' }}
				bufferedSeconds={0}
				onRecover={() => void av.join({ mic: av.micBeforeDrop })}
			/>
		</div>
	{:else if av.status === 'failed'}
		<!-- LiveKit did not connect (audit 2026-09-09): one of the named
		     ride-critical errors, and it was a 10 px word in the sidebar.
		     The one big button is the way back. -->
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'voice', state: 'lost' }}
				bufferedSeconds={0}
				onRecover={() => void av.join({ mic: av.micBeforeDrop })}
			/>
		</div>
	{:else if av.status === 'live' && av.micFault}
		<!-- The capture died under an open mic (#640): we publish our own
		     WebAudio track, so LiveKit never notices and the room hears
		     silence with the icon still green. One big button back. -->
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'mic', state: 'lost' }}
				bufferedSeconds={0}
				onRecover={() => void av.reconnectMic()}
			/>
		</div>
	{/if}

	<!-- Not in the ranked chain above (#1466, ADR-0052): that chain is about
	     the ride happening now, and this is about the one that vanished.
	     Both can be true — a restart drops the trainer's socket too — and
	     this must not mask a trainer fault to say so. Persistent status with
	     the way back on it, because the samples are the rider's to rescue
	     and nobody else holds a copy. -->
	{#if live.lostSession}
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="error">
				<p>
					<span class="font-medium"
						>The room came back without the session — the server restarted.</span
					>
					<span class="text-muted"
						>{live.lostSession.minutes} min of {live.lostSession.workoutName}
						never reached your account. This browser still has the ride: open the
						ride screen to download it as a .fit file.</span
					>
				</p>
				{#snippet action()}
					<a href="/ride" class="btn btn-primary btn-lg">Recover the ride</a>
				{/snippet}
			</Banner>
		</div>
	{/if}

	<!-- No crash safety at all (#1466 finding 4, ADR-0052 rule 3). The banner
	     above is a ride that was buffered and cannot be saved; this is a ride
	     nothing is writing down, so neither a restart nor a tab crash leaves
	     even a .fit. There is no button: the rider cannot open IndexedDB from
	     here, and naming the two things that cause it is the only action
	     there is. Warn, not error — the ride itself records and saves. -->
	{#if live.noCrashSafety}
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="warn">
				<p>
					<span class="font-medium"
						>This browser is not keeping its own copy of this ride.</span
					>
					<span class="text-muted"
						>Storage would not open — a private window, or site data switched
						off. The room records and saves your ride as usual, but if the
						server restarts or this tab dies there will be nothing here to
						recover.</span
					>
				</p>
			</Banner>
		</div>
	{/if}

	{#if live.refusal}
		<!-- A refused command — a sprint armed at the wrong moment, a control
		     from a stale role — is status on every place, not a line under
		     the chat composer (audit 2026-09-09). It clears itself after a
		     few seconds (live.svelte.ts). -->
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="warn">{live.refusal}</Banner>
		</div>
	{/if}

	{#if shared?.phase === 'paused'}
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="warn">
				<p class="flex items-center gap-3 text-xs">
					<span
						class="bg-z5 h-2 w-2 shrink-0 rounded-full motion-safe:animate-pulse"
					></span>
					<span>
						<span class="font-medium">The session is paused.</span>
						<span class="text-muted"
							>Targets are released — spin easy until the coach resumes.</span
						>
					</span>
				</p>
			</Banner>
		</div>
	{/if}

	{#if device.narrow && av.playbackBlocked}
		<!-- On a phone the sidebar is a closed drawer, and these two lived
		     nowhere else (#1622): the browser waiting for a tap before it
		     plays, and a refused microphone — the commonest phone failures,
		     two taps deep behind the hamburger. -->
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="warn">
				You cannot hear the room — the browser is waiting for a tap.
				{#snippet action()}
					<button
						onclick={() => void av.startPlayback()}
						class="btn btn-primary btn-lg">Let me hear</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}
	{#if device.narrow && av.error}
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="error">{av.error.message}</Banner>
		</div>
	{/if}
{/if}
