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
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';

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
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'room', state: 'reconnecting' }}
				bufferedSeconds={droppedAt
					? Math.round((Date.now() - droppedAt) / 1000)
					: 0}
				onRecover={() => location.reload()}
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
					void rideCtl.ride(new FtmsTrainer());
				}}
			/>
		</div>
	{:else if av.status === 'reconnecting'}
		<!-- Media gapped while the SDK retries (#234). -->
		<div class="shrink-0 px-5 pt-4">
			<FaultBanner
				fault={{ kind: 'voice', state: 'reconnecting' }}
				bufferedSeconds={0}
				onRecover={() => void av.join()}
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

	{#if shared?.phase === 'paused'}
		<div class="shrink-0 px-5 pt-4">
			<Banner tone="warn">
				<p class="flex items-center gap-3 text-xs">
					<span class="bg-z5 h-2 w-2 shrink-0 animate-pulse rounded-full"
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
{/if}
