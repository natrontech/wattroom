<script lang="ts">
	// Your own workout in a voice channel (#2329, ADR-0059 amended): the
	// ride-alone lifecycle on the channel's riding surface — the count-in,
	// your own clock, the summary — beside anything running here. ADR-0046's
	// one riding surface: /ride's screens, with the channel around them.
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { useChannel } from '$lib/channel/context';
	import { ridePath } from '$lib/channel/address';
	import { liveSessionId } from '$lib/channel/tick-session';
	import Banner from '$lib/components/Banner.svelte';
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import RidingScreen from '$lib/ride/RidingScreen.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import { createRideSounds, guardOfRide } from '$lib/ride/ride-sounds.svelte';
	import { describeBlock } from '$lib/workout/block';
	import { signalLost as isSignalLost } from '$lib/workout/ride-state';
	import Radio from '@lucide/svelte/icons/radio';

	const channel = useChannel();
	const conn = $derived(channelConnection.current);
	const own = $derived(conn?.ownRide);
	const session = $derived(own?.session ?? null);
	const workout = $derived(own?.workout ?? null);
	const profile = $derived(conn?.profile.current);
	const ftp = $derived(profile?.ftp ?? 0);

	// /ride's rule (#1799, #2200): silence counts from the clock, not the
	// first sample, so a trainer that never sends watts is said.
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (nowMs = Date.now()), 1000);
		return () => clearInterval(id);
	});
	let ridingSince: number | undefined = $state();
	$effect(() => {
		if (session?.state === 'running' && ridingSince === undefined)
			ridingSince = Date.now();
		if (!session) ridingSince = undefined;
	});
	const signalLost = $derived(isSignalLost(session, ridingSince, nowMs));
	const block = $derived(
		session && workout && session.segments.length > 0
			? describeBlock(
					session.info,
					session.segments,
					workout,
					ftp,
					session.trace,
				)
			: null,
	);

	// The cues a ride alone plays (#1792), from this ride's own state.
	createRideSounds({
		fault: () => (signalLost ? 'trainer' : null),
		sprint: () => session?.sprint ?? null,
		guard: () => guardOfRide(session?.state),
		spiral: () => session?.spiralActive,
		block: () =>
			session &&
			session.state !== 'idle' &&
			session.state !== 'countdown' &&
			session.state !== 'done'
				? session.info.segmentIndex
				: undefined,
		countdown: () =>
			session?.state === 'countdown'
				? Math.max(1, session.countdownRemaining)
				: session?.state === 'running'
					? 0
					: undefined,
		ended: () => session?.state === 'done',
	});

	// A session beside you: it leaves your trainer alone, and joining it saves
	// this ride first (ADR-0059).
	const running = $derived(
		channel.phase !== 'lounge'
			? liveSessionId(conn?.live.tick?.state)
			: undefined,
	);
	const outcome = $derived(own?.outcome ?? null);
</script>

{#if own && session && workout}
	<div class="page flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-8">
		{#if session.state === 'countdown' || session.state === 'idle'}
			<CountdownScreen
				remaining={session.countdownRemaining}
				title={workout.name}
				note={block
					? `first up · ${block.label}${block.watts > 0 ? ` ${block.watts} W` : ''}`
					: undefined}
			>
				{#snippet controls()}
					<button onclick={() => own.cancel()} class="btn btn-secondary btn-lg"
						>Cancel</button
					>
				{/snippet}
			</CountdownScreen>
		{:else if session.state !== 'done'}
			{#if running}
				<div
					class="border-muted/20 flex flex-wrap items-center gap-3 rounded-lg border p-3"
				>
					<p class="text-sm">
						{channel.shared?.coachName || 'Someone'} is running a session here. It
						leaves your trainer alone; joining saves this ride first.
					</p>
					<a
						href={ridePath(channel.address, running)}
						class="btn btn-accent btn-lg ml-auto"
						><Radio size={15} /> Join the ride</a
					>
				</div>
			{/if}
			<RidingScreen
				{session}
				{block}
				{workout}
				{ftp}
				kg={profile?.kg ?? 0}
				lthr={profile?.lthr}
				watts={session.sample?.watts ?? 0}
				target={session.target}
				{signalLost}
				noCrashSafety={own.noCrashSafety}
			/>
		{:else}
			<div class="mx-auto w-full max-w-3xl">
				<SessionSummary
					title={session.elapsed >= session.total
						? 'Ride complete'
						: 'Ride ended'}
					unsaved={!!outcome && 'failure' in outcome}
					subtitle="{workout.name} · {new Date().toLocaleDateString()}"
					samples={session.recording}
					{ftp}
					execution={session.scored ? session.execution : undefined}
				>
					{#snippet actions()}
						<div class="panel panel-lg">
							<div class="flex flex-wrap items-center gap-2">
								{#if outcome && 'saved' in outcome && outcome.saved}
									<a href="/history/{outcome.saved}" class="btn btn-primary"
										>See your ride</a
									>
								{:else if own.saving}
									<button disabled class="btn btn-primary">Saving…</button>
								{/if}
								<button
									onclick={() => own.dismiss()}
									disabled={own.saving}
									class="btn btn-secondary">Back to the free ride</button
								>
							</div>
							{#if outcome && 'failure' in outcome}
								<div class="mt-2">
									<Banner tone="warn">
										It did not save — {outcome.failure.message} It is kept on this
										device, and Ride offers it again.
									</Banner>
								</div>
							{:else if outcome && 'nothing' in outcome}
								<p class="text-muted mt-2 text-sm" role="status">
									Nothing was recorded — no watts reached the app.
								</p>
							{/if}
						</div>
					{/snippet}
				</SessionSummary>
			</div>
		{/if}
	</div>
{/if}
