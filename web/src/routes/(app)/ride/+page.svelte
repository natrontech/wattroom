<script lang="ts">
	import { canSimulate } from '$lib/ble/can-simulate';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { byId } from '$lib/workout/library';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createHistoryStore } from '$lib/history.svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import TheRide from '$lib/ride/TheRide.svelte';
	import { withProfile } from '$lib/workout/road-workout';
	import PreRide from '$lib/ride/PreRide.svelte';
	import RideDoors from '$lib/ride/RideDoors.svelte';
	import FigureCard from '$lib/ride/FigureCard.svelte';
	import SoloRoadRide from '$lib/ride/SoloRoadRide.svelte';
	import type { RideableRoute } from '$lib/ride/roads';
	import type { RideKind } from '$lib/ride/RideCard.svelte';
	import {
		lastRoad,
		lastWorkout,
		rememberRoad,
		rememberWorkout,
	} from '$lib/ride/last-ride';
	import { onRoute } from '$lib/road/compile';
	import { legsOf, nextLeg } from '$lib/road/leg';
	import { formatKm } from '$lib/format';
	import { doorsFor } from '$lib/crew-lounge';
	import { ownRoad } from '$lib/ride/free-ride-controls';
	import { crewLive } from '$lib/nav/crew-live.svelte';

	// The library is the source of workouts now; ?w=<id> selects one, and the default
	// is the session most people ride.
	const custom = customWorkouts();
	const requested = page.url.searchParams.get('w') ?? '';
	// One of your own roads (#3027); `from` is where on it to start: a
	// recovered ride's stop, or the route page's chip.
	const roadId = page.url.searchParams.get('road');
	const roadFrom = Math.max(0, Number(page.url.searchParams.get('from')) || 0);
	// The road's own workout, leg k of it (#3601), from the route page's Ride
	// its workout: compiled at this rider's FTP and weight once the road is in.
	const leg = roadId
		? Math.max(0, Math.floor(Number(page.url.searchParams.get('leg'))) || 0)
		: 0;
	// A planned session's road, ridden first (#3621): the crew's cut of it.
	const planRoad = (() => {
		const crew = page.url.searchParams.get('crew');
		const id = page.url.searchParams.get('plan');
		return crew && id ? { crew, id } : null;
	})();
	const profile = createProfileStore();
	const ftp = $derived(profile.current.ftp);
	// What this device rode alone last (#3671): the Ride card opens on it.
	const remembered = lastRoad();
	const rememberedWorkout = lastWorkout();
	const pick = requested || rememberedWorkout || '';
	// Derived, not once: the shelf loads async — read at init it is always
	// empty, and every custom ride silently fell back to the default.
	const saved = $derived(custom.byId(pick));
	const selected = $derived(
		byId(pick) ??
			(saved
				? {
						id: saved.id,
						focus: 'Custom' as const,
						summary: 'Your own workout.',
						workout: saved.workout,
					}
				: byId('sweet-spot-2x20')!),
	);
	// “Last: <workout>”, whichever workout the card shows.
	const lastName = $derived(
		rememberedWorkout
			? (byId(rememberedWorkout)?.workout.name ??
					custom.byId(rememberedWorkout)?.workout.name)
			: undefined,
	);
	// The Ride card's answers (#3671). ?w= opens on Workout, with road= on
	// that road (#3594); road= alone opens on a free ride on it, the one setup
	// a road ride has (#3855); otherwise a remembered road opens on a free ride.
	let kind = $state<RideKind>(
		!requested && !leg && (roadId || remembered) ? 'free' : 'workout',
	);
	let road = $state.raw<RideableRoute | null>(null);
	let from = $state(roadFrom);
	// Any workout on one of your own roads (#3594), from Terrain Match's
	// start or km 0. Blocks end by the clock; the dot rides the road.
	const ridesRoute = $derived(kind === 'workout' && !!road);
	// One of WattRoom's roads (#4248): ridden, never saved against (#4262).
	const borrowed = $derived(!!road?.borrowed);
	const legs = $derived(
		leg && road ? legsOf(road, ftp, profile.current.kg) : [],
	);
	const workout = $derived(
		legs.length > 0
			? legs[Math.min(leg, legs.length) - 1]
			: ridesRoute && road
				? withProfile(onRoute(selected.workout, road, from), road)
				: selected.workout,
	);
	// A free ride on a road, started from the card with the paired trainer.
	let freeRide = $state.raw<{
		id: string;
		from: number;
		trainer: Trainer;
	} | null>(null);
	// The figure card (ADR-0073, #3342) comes once, before a rider's first ride
	// with a road; its answer, a save or a skip, then starts the ride.
	let askFigure = $state.raw<Trainer | null>(null);
	function start(trainer: Trainer) {
		const hasRoad = (kind === 'free' || ridesRoute) && !!road;
		if (hasRoad && account.figureUnasked) {
			askFigure = trainer;
			return;
		}
		if (kind === 'free' && road) {
			freeRide = { id: road.id, from, trainer };
			return;
		}
		void begin(trainer);
	}
	// A requested workout that is not built in waits for the shelf, and a
	// shelf that failed or does not hold it is said — the fallback used to
	// ride Sweet Spot 2×20 under a different name with no word (audit
	// 2026-09-09).
	const wanted = $derived(!!requested && !byId(requested));
	const shelfPending = $derived(wanted && !custom.loaded);
	const shelfMissing = $derived(wanted && custom.loaded && !saved);

	// The two doors (#3274): a rider with a crew chooses between riding alone
	// and riding in the crew's lounge. Not when a workout or a road was
	// already picked — the lounge's free ride has neither, and Home's "Ride
	// alone" arrives here with ?alone, so that choice stays one tap.
	let alone = $state(
		page.url.searchParams.has('alone') || !!requested || !!roadId,
	);
	const doors = $derived(!alone && doorsFor(crewLive));

	// FTP comes from the profile, set by hand or measured by a ramp test (#14).
	const history = createHistoryStore(() => account.me?.id);
	// The profile is FTP's only home — the field below writes through to it, so a
	// rider who corrects the number here does not find the old one on /settings/profile.
	// The ride is the app's (ADR-0093): this page draws it and never owns it.
	const session = $derived(theRide.session);
	// What is ridden now: the setup's workout, until Change workout (#4257).
	const riding = $derived(session?.workout ?? workout);
	// The setup is a desk page and wears the page frame (G7); the ride and
	// its summary keep the riding surface's own gutters.
	const setup = $derived(
		!theRide.road &&
			!freeRide &&
			!(planRoad && !requested) &&
			(!session || session.state === 'idle'),
	);
	let error = $state<string | null>(null);

	// ?replay=<fixture> rides a committed capture instead of the generator
	// (#54): deterministic reproduction, the agent's screenshot instead of the
	// rider's.
	// WATTROOM.md: simulators are dev-flag equipment, and there is one gate for
	// that now (#1000). `?sim=1` is gone with it: it was a URL any rider could
	// type, and the e2e it existed for signs in through the dev door instead —
	// which the gate admits on the production BUILD CI rides.
	const replayName = $derived(
		canSimulate() ? page.url.searchParams.get('replay') : null,
	);
	async function beginReplay() {
		error = null;
		try {
			const res = await fetch(`/fixtures/${replayName}.json`);
			if (!res.ok) throw new Error(`No fixture named ${replayName}.`);
			const fixture = await res.json();
			const replaying = new SimulatedTrainer({ replay: fixture.samples });
			// A free ride on a road takes the trainer as the card's Start does.
			if (kind === 'free' && road) start(replaying);
			else await begin(replaying);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	// Paired before the ride, not by starting it (#611): the paired-devices
	// grid below owns the trainer until Start hands it to the session.
	const solo = soloTrainer();

	async function begin(trainer: Trainer) {
		error = null;
		rememberWorkout(selected.id);
		if (workout.road && road && !road.borrowed) rememberRoad(road.id);
		try {
			await theRide.begin(trainer, workout, {
				borrowed,
				// The leg's way on goes with the ride: the setup is gone on a
				// return to this page (#3601).
				next:
					road && legs.length > 0
						? nextLeg(road.id, Math.min(leg, legs.length), legs.length)
						: null,
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<svelte:head
	><title
		>{shelfPending || shelfMissing ? 'Ride' : riding.name} · Ride · WattRoom</title
	></svelte:head
>

<!-- Mid-ride the whole frame is the ride, sidebar included (ADR-0020): the
     layout reads theRide.live. Setup and the summary are desk surfaces;
     all three keep the rider's scheme (#4160). A road ride's closing card
     wears the page frame as a workout's does (G7, #4235). -->
<!-- px-4 on a phone is the kit's gutter (`page`, ux.md's 16 px); the ride
     surface is not a `page` — it fills the window — so it spells the two. -->
<main
	class="bg-surface text-ink flex min-h-screen flex-col {setup ||
	session?.state === 'done' ||
	theRide.road?.ended
		? 'page'
		: 'px-4 py-5 sm:px-6'}"
>
	<!-- A ride already under way is the screen, whatever the address asks
	     for: the device has one ride (ADR-0093). -->
	{#if theRide.road || (session && session.state !== 'idle') || theRide.channel?.riding}
		<TheRide />
	{:else if askFigure}
		<FigureCard
			onDone={() => {
				const trainer = askFigure;
				askFigure = null;
				if (trainer) start(trainer);
			}}
		/>
	{:else if freeRide}
		<SoloRoadRide
			roadId={freeRide.id}
			from={freeRide.from}
			trainer={freeRide.trainer}
		/>
	{:else if planRoad && !requested}
		<!-- A crew's planned road keeps its own setup: the card rides only
		     your roads, and this one is the crew's cut (#3621). -->
		<SoloRoadRide plan={planRoad} />
	{:else}
		<!-- Idle with a session in hand is the moment between Start and the
		     trainer answering it (#1800): still the setup screen, because
		     nothing is counting in yet. -->
		{#if shelfPending}
			<Skeleton class="h-8 w-56" />
			<Skeleton class="mt-6 h-48" />
		{:else if shelfMissing}
			<Banner tone="error">
				{custom.error ?? 'That workout is not on your shelf any more.'}
				{#snippet action()}
					{#if custom.error}
						<button onclick={() => custom.retry()} class="btn-link text-xs"
							>Retry</button
						>
					{:else}
						<a href="/workouts" class="btn-link text-xs">Open Workouts</a>
					{/if}
				{/snippet}
			</Banner>
		{:else if doors}
			<RideDoors onAlone={() => (alone = true)} />
		{:else}
			<PreRide
				bind:kind
				bind:road
				bind:from
				roadId={roadId || remembered}
				{remembered}
				lastWorkout={lastName}
				{workout}
				summary={legs.length > 0
					? `ERG by the road, at your FTP: leg ${Math.min(leg, legs.length)} of ${legs.length}.`
					: ridesRoute && road
						? `${selected.summary} On ${road.name}, ${from > 0 ? `from km ${formatKm(from)}` : 'from its start'}.`
						: selected.summary}
				{ftp}
				{solo}
				{replayName}
				{error}
				pick={legs.length > 0 ? undefined : selected.id}
				pickRoad={ridesRoute ? ownRoad(road) : undefined}
				onStart={start}
				onReplay={beginReplay}
				onSaved={(ride) => history.remove(String(ride.startedAt))}
				onFtp={async (next) => {
					// The account first (#1543): the other order reported a
					// number the next boot pulled back over.
					error =
						(await pushProfile({ ftpWatts: next })) ??
						profile.update({ ftp: next });
				}}
				onError={(message) => (error = message)}
			/>
		{/if}
	{/if}
</main>
