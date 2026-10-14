<script lang="ts">
	// One past ride, opened (#503). The Rides list was a line per ride that
	// went nowhere; this is the ride itself — the trace over the FTP line,
	// where the time went, the numbers it was scored on, and what it won.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatDuration } from '$lib/format';
	import { MEDAL_META, medalName } from '$lib/medals';
	import { cardLabel, downloadRideCard } from '$lib/ride/card';
	import { deleteRideAfterConfirm } from '$lib/ride/delete-ride';
	import { fetchRide, type RideDetail } from '$lib/ride/detail';
	import FitImportHelp from '$lib/ride/FitImportHelp.svelte';
	import RecapHeader from '$lib/ride/RecapHeader.svelte';
	import RecapTiles from '$lib/ride/RecapTiles.svelte';
	import { recapEyebrow, recapTiles, rideKind } from '$lib/ride/recap-frame';
	import RideDelivery from '$lib/ride/RideDelivery.svelte';
	import { rideTitle } from '$lib/ride/list';
	import { rideRowMenu } from '$lib/ride/row-menu';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { rideBackLink } from '$lib/back-link';
	import { bestQuery } from '$lib/ride/compare';
	import RideComparison from '$lib/ride/RideComparison.svelte';
	import RideSkyline from '$lib/ride/RideSkyline.svelte';
	import type { RideRecord } from '$lib/history.svelte';
	import { api } from '$lib/api';
	import {
		fetchProgression,
		SHOWN_WINDOWS,
		type Progression,
	} from '$lib/progression';
	import { apiBlob } from '$lib/api';
	import { downloadBlob } from '$lib/download';
	import { zoneSeconds } from '$lib/ride/stats';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Award from '@lucide/svelte/icons/award';
	import Download from '@lucide/svelte/icons/download';
	import ImageDown from '@lucide/svelte/icons/image-down';
	import RideFeel from '$lib/ride/RideFeel.svelte';
	import ShareToggle from '$lib/ride/ShareToggle.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const id = $derived(page.params.id ?? '');
	let ride = $state<RideDetail | null>(null);
	// Flows rules 2 and 4 (#3874): a ride on the rider's own road is named as
	// its route page is, and goes back to the page that opened it.
	const back = $derived(
		rideBackLink(page.url.searchParams.get('back'), ride?.road),
	);
	const title = $derived(ride ? rideTitle(ride) : null);
	let error = $state<string | null>(null);
	// A ride that is not yours reads as absent, and retrying will not find it —
	// so it gets the empty state, not the error-with-retry one.
	let missing = $state(false);
	async function removeRide() {
		if (ride && (await deleteRideAfterConfirm(ride))) void goto('/history');
	}
	let exporting = $state(false);
	let carding = $state(false);
	// One banner for both downloads, carrying the retry that belongs to
	// whichever one failed — two near-identical banners is the duplication
	// the second download would have added.
	let downloadError = $state<{ message: string; retry: () => void } | null>(
		null,
	);

	// The comparison (#996) reads two lists the app already serves — every ride
	// for "your best of this workout", and the curve for the 20-minute line.
	// Both are secondary to the ride itself, so they load beside it and their
	// absence costs one section rather than the page.
	let best = $state<RideRecord | null>(null);
	let bestLoaded = $state(false);
	let ridesError = $state<string | null>(null);
	let progression = $state<Progression | null>(null);
	function loadRides() {
		ridesError = null;
		if (!ride) return;
		void api<{ ride: RideRecord | null }>(bestQuery(ride)).then((res) => {
			if (res.ok) {
				best = res.data.ride;
				bestLoaded = true;
			} else ridesError = res.error.message;
		});
	}
	// Its failure is one line under the comparison, not vanished bests (#1555).
	let progressionError = $state<string | null>(null);
	function loadProgression() {
		progressionError = null;
		void fetchProgression().then((res) => {
			if (res.ok) progression = res.data;
			else progressionError = res.error.message;
		});
	}
	loadProgression();

	async function downloadFit() {
		if (!ride || ride.samples.length === 0) return;
		exporting = true;
		downloadError = null;
		const res = await apiBlob(`/api/rides/${encodeURIComponent(id)}/export`);
		if (res.ok) {
			downloadBlob(res.data.blob, res.data.filename ?? `wattroom-${id}.fit`);
		} else downloadError = { message: res.error.message, retry: downloadFit };
		exporting = false;
	}

	// The picture of this ride (#2112) — the one a rider adds to the Strava
	// activity by hand, because Strava's API takes the ride and not a photo
	// of it. Drawn from the numbers on this page, so it needs no samples.
	async function downloadCard() {
		carding = true;
		downloadError = null;
		const message = await downloadRideCard(id);
		if (message) downloadError = { message, retry: downloadCard };
		carding = false;
	}

	async function load(which: string) {
		const res = await fetchRide(which);
		if (res.ok) {
			ride = res.data;
			error = null;
			missing = false;
			// The best of this workout needs the workout's name (#1687): asked
			// before the ride had loaded, the server refused an empty one.
			loadRides();
			return;
		}
		missing = res.error.error === 'not_found';
		error = res.error.message;
	}

	$effect(() => {
		const which = id;
		ride = null;
		error = null;
		missing = false;
		downloadError = null;
		best = null;
		bestLoaded = false;
		if (which) void load(which);
	});

	const zones = $derived(ride ? zoneSeconds(ride.samples, ride.ftp) : []);
	const trace = $derived(
		ride
			? ride.samples.map((sample, second) => ({ t: second, w: sample.watts }))
			: [],
	);
	/** SPEC's four curve windows as the page's cells (#1691). */
	const curveCells = $derived.by<[string, number][]>(() => {
		const curve = ride?.curve;
		return curve
			? SHOWN_WINDOWS.map((w) => [`best ${w.label}`, curve[w.key]])
			: [];
	});
	const tiles = $derived(
		ride
			? recapTiles({
					...ride,
					execution:
						ride.executionScored === false ? undefined : ride.execution,
				})
			: [],
	);
</script>

<svelte:head><title>{title ?? 'Ride'} · Rides · WattRoom</title></svelte:head>

<main class="page">
	<a
		href={back.href}
		class="text-muted hover:text-ink link-standalone gap-1.5 text-xs"
	>
		<ArrowLeft size={14} />
		{back.label}
	</a>

	{#if missing}
		<div class="mt-8">
			<!-- Empty states teach (ux.md): what happened, then the way on. -->
			<EmptyState>
				<p class="text-ink text-sm">This ride isn't here.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					It was deleted, or it belongs to another rider. Your own rides are all
					on the Rides page.
				</p>
				{#snippet cta()}
					<a href="/history" class="btn btn-secondary">Open Rides</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load(id)} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if ride === null}
		<div class="mt-4">
			<Skeleton class="h-7 w-64" />
			<Skeleton class="mt-2 h-3 w-44" />
			<Skeleton class="mt-6 h-28" />
			<div class="mt-3 grid gap-3 sm:grid-cols-3">
				{#each { length: 6 } as _, i (i)}
					<Skeleton class="h-20" />
				{/each}
			</div>
		</div>
	{:else}
		<!-- The header's actions are a snippet, which loses the narrowing. -->
		{@const shown = ride}
		<!-- Right-click or long-press: the ride's own menu, the one its row
		     opens, with Delete last there too (ux.md, Right-click). -->
		<div
			class="mt-4"
			{@attach contextMenu(() =>
				rideRowMenu(shown, () => void goto('/history')),
			)}
		>
			<RecapHeader
				eyebrow={recapEyebrow(
					new Date(ride.startedAt),
					rideKind(ride),
					ride.crew?.name,
				)}
				title={title ?? ride.workoutName}
			>
				{#snippet subline()}
					{new Date(shown.startedAt).toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short',
					})}
					<!-- The crew is the link (#2457), the channel the words. The
					     eyebrow names the crew; a crew the rider left is not
					     linked, its page is not theirs to open (#2630). -->
					{#if shown.crew && shown.crewMember}
						· <a
							href="/crew/{shown.crew.id}"
							class="hover:text-ink underline underline-offset-2"
							>{shown.crew.name}</a
						>{#if shown.channel}&nbsp;in {shown.channel.name}{/if}
					{/if}
				{/snippet}
				{#snippet actions()}
					<!-- The per-ride opt-in, where a rider decides a ride is worth
					     showing (#1691, ADR-0024): undo over confirm. The same toggle
					     the history row draws — this one used to name the STATE, so
					     "Private" was the button you pressed to share (#2167). -->
					<ShareToggle ride={shown} class="btn btn-secondary" />
					<button
						onclick={() => void downloadCard()}
						disabled={carding}
						class="btn btn-secondary disabled:opacity-50"
					>
						<ImageDown size={14} />
						{carding ? 'Drawing…' : cardLabel(shown)}
					</button>
					<button
						onclick={() => void downloadFit()}
						disabled={exporting || shown.samples.length === 0}
						title="Download this ride as a FIT file"
						class="btn btn-secondary disabled:opacity-50"
					>
						<Download size={14} />
						{exporting ? 'Preparing…' : 'Export'}
					</button>
					<!-- Delete last, after a separator, as in the ride's context
					     menu. On a phone the row wraps and a separator would end a
					     line, so Delete stands alone there by position. -->
					<span aria-hidden="true" class="bg-ink/10 hidden h-6 w-px sm:block"
					></span>
					<button onclick={() => void removeRide()} class="btn btn-danger">
						<Trash2 size={14} /> Delete ride
					</button>
				{/snippet}
			</RecapHeader>
		</div>
		<div class="mt-4"><RecapTiles {tiles} /></div>
		{#if downloadError}<div class="mt-3">
				<Banner tone="error">
					{downloadError.message}
					{#snippet action()}<button
							class="btn-link text-xs"
							onclick={() => downloadError?.retry()}>Retry</button
						>{/snippet}
				</Banner>
			</div>
		{:else if ride.samples.length === 0}
			<p class="text-muted mt-3 text-xs">
				No samples were stored for this ride, so there is no FIT file to export.
			</p>
		{/if}

		{#if ride.samples.length > 0}
			<FitImportHelp />
		{/if}

		<section class="panel panel-xl mt-6">
			<h2 class="eyebrow">how it went</h2>
			<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
				Your power second by second, against the dashed line at your FTP of
				{ride.ftp} W — the FTP the ride was scored on, not today's.
			</p>
			{#if trace.length > 0}
				<!-- No segments: a saved ride keeps its samples, not the workout it
				     was ridden to, so the profile blocks would be invented. -->
				<IntervalGraph
					segments={[]}
					total={ride.seconds}
					elapsed={0}
					ftp={ride.ftp}
					{trace}
				/>
			{:else}
				<p class="text-muted text-xs">
					No power trace was stored for this ride — its numbers are still the
					ones it was scored on.
				</p>
			{/if}
		</section>

		<RideSkyline samples={ride.samples} distanceM={ride.distanceM} />

		{#if ride.curve}
			<!-- The ride's own curve (SPEC's four windows, #1691): computed at
			     save and in the export, and never shown until now. -->
			<section class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each curveCells as [label, watts] (label)}
					<!-- RecapTiles' tile, so one kind of number reads one way. -->
					<div class="panel py-2">
						<div class="eyebrow leading-none">{label}</div>
						<div class="mt-1 flex items-baseline gap-1">
							<span
								class="font-display text-2xl leading-none font-bold tabular-nums"
								>{watts > 0 ? watts : '–'}</span
							>
							{#if watts > 0}<span class="text-muted text-xs">W</span>{/if}
						</div>
					</div>
				{/each}
			</section>
		{/if}

		<div class="mt-6">
			<RideComparison
				{ride}
				{best}
				loading={!bestLoaded}
				error={ridesError}
				onRetry={loadRides}
				d30={progression?.curve.d30.best20m}
				d90={progression?.curve.d90.best20m}
			/>
			{#if progressionError}
				<p class="text-muted mt-2 text-xs">
					Your 30- and 90-day bests could not be loaded — {progressionError}
					<button onclick={loadProgression} class="btn-link">Retry</button>
				</p>
			{/if}
		</div>

		{#if zones.some((seconds) => seconds > 0)}
			<section class="panel panel-xl mt-3">
				<h2 class="eyebrow">time in zone</h2>
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					Where the {formatDuration(ride.seconds)} actually went.
				</p>
				<ZoneBar seconds={zones} legend />
			</section>
		{/if}

		{#if ride.medals.length > 0}
			<section class="mt-3">
				<h2 class="eyebrow">what it won</h2>
				<ul class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					{#each ride.medals as medal (medal.kind)}
						<li class="panel flex items-center gap-2.5">
							<Award size={18} class="text-neon shrink-0" />
							<span class="min-w-0">
								<span class="block truncate text-xs font-medium"
									>{medalName(medal.kind)}</span
								>
								<span class="text-muted block text-[10px]">
									{MEDAL_META[medal.kind]?.criterion ?? medal.crewName}
								</span>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- What the rider says about it (#2328). Below the numbers because it
		     answers them; above "where it went", which is bookkeeping. Private
		     whatever the share toggle above says — ADR-0055. -->
		<RideFeel id={ride.id} feel={ride.feel} />

		{#if ride.export}
			<RideDelivery
				id={ride.id}
				delivery={ride.export}
				onRetried={() => load(id)}
			/>
		{/if}
	{/if}
</main>
