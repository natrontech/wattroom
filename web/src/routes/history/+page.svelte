<script lang="ts">
	import FitnessChart from '$lib/components/FitnessChart.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import { account } from '$lib/account.svelte';
	import LthrPrompt from '$lib/components/LthrPrompt.svelte';
	import {
		declineSuggestion,
		declinedSuggestion,
		suggestionDeclined,
	} from '$lib/suggestion-decline';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
	import {
		fetchProgression,
		FORM_SENTENCES,
		type Progression,
	} from '$lib/progression';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import RecoveredRides from '$lib/ride/RecoveredRides.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { api } from '$lib/api';
	import { formatClock } from '$lib/format';
	import { createHistoryStore, type RideRecord } from '$lib/history.svelte';
	import { toasts } from '$lib/toast.svelte';
	import ShareToggle from '$lib/ride/ShareToggle.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { rideRowMenu } from '$lib/ride/row-menu';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import {
		rideCursorOf,
		rideCursorQuery,
		type RideCursor,
		type RidesPage,
		type ServerRide,
		ridePlace,
	} from '$lib/ride/list';

	let { data }: { data: PageData } = $props();

	// The FTP prompt where the rider is looking at the curve (#1552):
	// WATTROOM.md has the server prompt when the curve outgrows the setting,
	// and a settings sub-page was the only place that did. The decline is
	// remembered, keyed on the value.
	const profile = createProfileStore();
	// The suggestion rides on /api/me, which a ride just saved has moved:
	// read it again on the way in, as Home does (#2626).
	void account.load();
	let declined = $state(declinedSuggestion('ftp'));
	let applied = $state(false);
	const suggestion = $derived(
		account.me?.suggestedFtp &&
			!applied &&
			!suggestionDeclined(account.me.suggestedFtp, declined)
			? account.me.suggestedFtp
			: null,
	);
	async function applySuggestion(next: number) {
		const message =
			(await pushProfile({ ftpWatts: next })) ??
			profile.update({ ftp: next, ftpMeasuredAt: Date.now() });
		if (message) {
			toasts.push(message, { tone: 'error' });
			return;
		}
		applied = true;
		toasts.push(`FTP set to ${next} W — every workout now scales to it.`);
	}
	// The same, for the LTHR a hard solo ride suggests (#1620). Its own decline
	// memory: keeping an FTP says nothing about a heart rate.
	let lthrDeclined = $state(declinedSuggestion('lthr'));
	let lthrApplied = $state(false);
	const lthrSuggestion = $derived(
		account.me?.suggestedLthr &&
			account.me.lthr &&
			!lthrApplied &&
			!suggestionDeclined(account.me.suggestedLthr, lthrDeclined)
			? account.me.suggestedLthr
			: null,
	);
	async function applyLthr(next: number) {
		// The account first, this browser second (#1543, #1571).
		const message =
			(await pushProfile({ lthr: next })) ?? profile.update({ lthr: next });
		if (message) {
			toasts.push(message, { tone: 'error' });
			return;
		}
		lthrApplied = true;
		toasts.push(`LTHR set to ${next} bpm — your heart-rate zones follow it.`);
	}
	// Device-only leftovers: summaries the server did not take — refused for
	// being under a minute, saved while it was unreachable, or from before
	// #110. They have no samples, so they cannot become account rides — they
	// stay listed here until cleared.
	const device = createHistoryStore(() => account.me?.id);

	async function clearDevice() {
		const n = device.all.length;
		const ok = await confirm({
			title: `Clear ${n} device ride${n === 1 ? '' : 's'}?`,
			body: 'These summaries exist only on this device — nothing can bring them back.',
			action: 'Clear them',
			cancel: 'Keep it',
		});
		if (ok) device.clear();
	}

	let rides = $state<ServerRide[] | null>(untrack(() => data.rides));
	let error = $state<string | null>(untrack(() => data.ridesError));
	// The list is paged (#1549): the server says whether older rides exist,
	// and the next page begins before the oldest one here. Its failure is
	// its own inline line — the page banner is for the page.
	let more = $state(untrack(() => data.more));
	// The cursor is the server's own (#2064) — see rideCursorOf. `more` says
	// there are older rides AND that we were told where they start: a page
	// that claims one without the other would loop on the same rows.
	let cursor = $state<RideCursor | null>(untrack(() => data.cursor));
	let loadingMore = $state(false);
	let moreError = $state<string | null>(null);
	function takePage(page: RidesPage) {
		cursor = rideCursorOf(page);
		more = !!page.more && !!cursor;
	}
	async function loadMore() {
		if (!cursor || loadingMore) return;
		loadingMore = true;
		moreError = null;
		const res = await api<RidesPage>(`/api/rides?${rideCursorQuery(cursor)}`);
		loadingMore = false;
		if (!res.ok) {
			moreError = res.error.message;
			return;
		}
		rides = [...(rides ?? []), ...res.data.rides];
		takePage(res.data);
	}

	// What the row's menu leaves to this page once a ride is gone.
	function forget(ride: ServerRide) {
		rides = rides?.filter((r) => r.id !== ride.id) ?? null;
		// The charts count this ride — they have to be asked again.
		void loadProgression();
	}

	// A chart's drilldown (the rides chart above, once /progression's) lands here with ?ride=<id> — ring it.
	let highlightId = $state<string | null>(null);

	// A ride that never reached the account waits here (#2616): Home and the
	// channel's banner point at this page, not at /ride's setup screen.
	let recoverError = $state<string | null>(null);

	async function load() {
		const res = await api<RidesPage>('/api/rides');
		if (res.ok) {
			rides = res.data.rides;
			// Retry starts the list over, so the cursor has to as well —
			// keeping the old one would page from a row this list no longer
			// ends on.
			takePage(res.data);
			error = null;
			await ring(rides);
		} else {
			error = res.error.message;
		}
	}

	// The rides arrive seeded from load() (#772) and nothing calls load()
	// until Retry — so the mount is where the ring happens now (#824).
	$effect(() => {
		const seeded = untrack(() => rides);
		if (seeded) void ring(seeded);
	});

	/** Pages forward until the ride is on the page, or the history runs out
	 *  (#1687): a chart plots a year, the list holds one page, and a click
	 *  on an older dot used to do nothing at all. */
	async function ensureLoaded(id: string): Promise<boolean> {
		while (!rides?.some((ride) => ride.id === id)) {
			if (!more || moreError) return false;
			await loadMore();
		}
		return true;
	}

	async function ring(list: ServerRide[]) {
		const picked = page.url.searchParams.get('ride');
		if (picked && !list.some((ride) => ride.id === picked)) {
			await ensureLoaded(picked);
		}
		if (picked && rides?.some((ride) => ride.id === picked)) {
			highlightId = picked;
			await tick();
			// Instant, retried: smooth scrolling gets cancelled by the route
			// transition, and arriving from another page needs a position,
			// not an animation.
			for (const delay of [50, 400]) {
				setTimeout(() => {
					const row = document.getElementById(`ride-${picked}`);
					if (!row) return;
					const box = row.getBoundingClientRect();
					if (box.top > window.innerHeight * 0.8 || box.top < 0) {
						row.scrollIntoView({ behavior: 'instant', block: 'center' });
					}
				}, delay);
			}
		}
	}

	// ── Progression, absorbed (ADR-0020) ─────────────────────────────────────
	// The charts and the rides they are drawn from were two pages, and every
	// drilldown was a navigation between them.
	let progression = $state<Progression | null>(untrack(() => data.progression));
	let progressionError = $state<string | null>(
		untrack(() => data.progressionError),
	);
	async function loadProgression() {
		const res = await fetchProgression();
		if (res.ok) {
			progression = res.data;
			progressionError = null;
		} else {
			progressionError = res.error.message;
		}
	}

	// The drilldowns stay put now: the ride they point at is further down this
	// same page, so they ring it instead of navigating.
	async function ringRide(id: string) {
		if (!(await ensureLoaded(id))) return;
		highlightId = id;
		await tick();
		document.getElementById(`ride-${id}`)?.scrollIntoView({ block: 'center' });
	}
	/** How far a day's click may snap to a neighbouring ride (#1692): most
	 *  days carry none, and ringing a ride weeks away read as wrong. */
	const DAY_SNAP = 3;
	function openDay(date: string) {
		const target = new Date(date + 'T12:00:00Z').getTime();
		let best: string | null = null;
		let dist = Infinity;
		for (const ride of progression?.rides ?? []) {
			const d = Math.abs(new Date(ride.date).getTime() - target);
			if (d < dist) {
				dist = d;
				best = ride.id;
			}
		}
		if (best && dist <= DAY_SNAP * 24 * 3600 * 1000) {
			void ringRide(best);
			return;
		}
		const [y, m, d] = date.split('-').map(Number);
		toasts.push(
			`No rides on ${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`,
		);
	}
</script>

<svelte:head><title>Rides · WattRoom</title></svelte:head>

{#snippet rideRow(ride: RideRecord, server?: ServerRide)}
	<!-- A device-only ride has no server to flip or delete, so its row offers
	     nothing and keeps the browser's own menu. -->
	<li
		id="ride-{ride.id}"
		title={server ? MENU_HINT : undefined}
		class="panel relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 {highlightId ===
		ride.id
			? 'ring-z2/70 ring-1'
			: ''}"
		{@attach contextMenu(() => (server ? rideRowMenu(server, forget) : []))}
	>
		{#if server}
			<!-- The whole row opens the ride (#503): a tap target the size of the
			     row, which is what a rider off the bike reaches for. Overlaid
			     rather than wrapping, so the share button stays its own control. -->
			<a
				href="/history/{ride.id}"
				class="focus-visible:ring-neon/60 absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
			>
				<span class="sr-only">Open {ride.workoutName}</span>
			</a>
		{/if}
		<span class="font-display font-bold">{ride.workoutName}</span>
		{#if server?.exportState === 'failed'}
			<!-- The one delivery state worth a mark on the row (#1553): the ride
			     page says why and has the retry. Pending and delivered are the
			     normal course and stay quiet here. -->
			<span class="eyebrow text-danger" title="Open the ride to try again"
				>not on Strava</span
			>
		{/if}
		<span class="text-muted text-xs"
			>{new Date(ride.startedAt).toLocaleDateString()}</span
		>
		<!-- Where it was ridden (#2457): its own item, so the row's gap spaces
		     it and a narrow row wraps it whole. -->
		{#if server?.crew}
			<span class="text-muted text-xs">{ridePlace(server)}</span>
		{/if}
		<span class="text-muted ml-auto font-mono text-xs tabular-nums"
			>{formatClock(ride.seconds)}</span
		>
		<span class="font-mono text-xs tabular-nums">{ride.avgWatts} W</span>
		<span class="text-muted font-mono text-xs tabular-nums">{ride.kj} kJ</span>
		<!-- A ride whose workout prescribed no target has no execution to show;
		     the dash says so on hover rather than sitting there unexplained. -->
		<span
			class="font-display text-sm font-semibold tabular-nums"
			title={ride.executionScored === false
				? 'This workout had no power targets to score'
				: undefined}
			>{ride.executionScored === false
				? '—'
				: `${Math.round(ride.execution * 100)}%`}</span
		>
		{#if server}
			<!-- Per-ride sharing (ADR-0024): off by default, one tap to flip.
			     The same toggle the ride's own page draws (#2167). -->
			<ShareToggle
				ride={server}
				class="btn btn-ghost btn-xs relative -my-1 -mr-2"
			/>
		{/if}
	</li>
{/snippet}

<main class="page">
	<div class="flex flex-wrap items-center gap-3">
		<div>
			<h1 class="page-title">Rides</h1>
			<p class="text-muted text-xs">
				Private by default — share one with your friends from its row.
			</p>
		</div>
	</div>

	{#if recoverError}
		<div class="mt-6"><Banner tone="error">{recoverError}</Banner></div>
	{/if}
	<RecoveredRides
		onError={(message) => (recoverError = message)}
		onSaved={(ride) => {
			device.remove(String(ride.startedAt));
			void load();
		}}
	/>

	<!-- The prompts stand on their own (#2626): drawn inside the charts'
	     branch, a failed progression read hid them as well. -->
	{#if (lthrSuggestion && account.me?.lthr) || (suggestion && account.me)}
		<div class="mt-6 grid gap-3">
			{#if lthrSuggestion && account.me?.lthr}
				<LthrPrompt
					current={account.me.lthr}
					suggested={lthrSuggestion}
					onApply={() => void applyLthr(lthrSuggestion)}
					onKeep={() => {
						declineSuggestion('lthr', lthrSuggestion);
						lthrDeclined = lthrSuggestion;
					}}
				/>
			{/if}
			{#if suggestion && account.me}
				<FtpPrompt
					current={account.me.ftpWatts}
					suggested={suggestion}
					best20={account.me.best20m ?? 0}
					onApply={() => void applySuggestion(suggestion)}
					onKeep={() => {
						declineSuggestion('ftp', suggestion);
						declined = suggestion;
					}}
				/>
			{/if}
		</div>
	{/if}

	<!-- Progression, absorbed (ADR-0020): the charts and the rides they are
	     drawn from were two pages, and every drilldown was a navigation
	     between them. The charts ring a ride further down this page now. -->
	{#if progressionError}
		<div class="mt-8">
			<Banner tone="error">
				{progressionError}
				{#snippet action()}
					<button
						onclick={() => void loadProgression()}
						class="btn-link text-xs">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if progression === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 2 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border p-6">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-4 h-40" />
				</div>
			{/each}
		</div>
	{:else if progression.rides.length > 0}
		<div class="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<span class="text-muted text-xs">
				Category
				<span class="text-ink font-display text-sm font-bold"
					>{progression.category}</span
				>
				{#if progression.wkg > 0}
					· {progression.wkg.toFixed(1)} w/kg, 90-day best 20 min
				{/if}
			</span>
		</div>

		<div class="mt-3 grid gap-3 xl:grid-cols-2">
			<div class="panel panel-xl">
				<h2 class="text-ink text-sm font-semibold">Best power by duration</h2>
				<!-- ADR-0016: every load-derived surface says what it is scoped to (#1692). -->
				<span class="text-muted-dim ml-2 text-[11px]"
					>based on your WattRoom rides</span
				>
				<!-- Interpretation lives in the UI, not the rider's head: every
				     panel says what its numbers mean in one line. -->
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					Your hardest average power held for each duration. The shades compare
					now with your past: a darker bar reaching its lighter neighbours means
					you're back at your best.
				</p>
				<PowerCurveChart
					d30={progression.curve.d30}
					d90={progression.curve.d90}
					all={progression.curve.all}
				/>
			</div>
			<div class="panel panel-xl">
				<h2 class="text-ink text-sm font-semibold">FTP over the last year</h2>
				<!-- ADR-0016: every load-derived surface says what it is scoped to (#1692). -->
				<span class="text-muted-dim ml-2 text-[11px]"
					>based on your WattRoom rides</span
				>
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					The line is the FTP your rides were scored against; each dot is a
					ride's best 20 minutes, and each diamond the FTP a ramp test set. Dots
					climbing away above the line mean your FTP is due a retest.
				</p>
				<FtpTrendChart
					rides={progression.rides}
					onpick={(ride) => ringRide(ride.id)}
				/>
			</div>
			{#if progression.load && progression.load.series.length > 1}
				{@const load = progression.load}
				<div class="panel panel-xl xl:col-span-2">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h2 class="text-ink text-sm font-semibold">Training load</h2>
						<!-- ADR-0016: every load-derived surface says what it is scoped to (#1692). -->
						<span class="text-muted-dim ml-2 text-[11px]"
							>based on your WattRoom rides</span
						>
						{#if load.building}
							<span class="text-muted text-xs italic"
								>building history — form shows after your first month</span
							>
						{:else}
							<span class="text-ink font-display text-sm font-semibold">
								form {load.formPct > 0 ? '+' : ''}{Math.round(load.formPct)}%
							</span>
							<span class="text-muted text-xs"
								>{FORM_SENTENCES[load.zone] ?? load.zone}</span
							>
						{/if}
					</div>
					<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
						Every ride adds load. Fitness is the load your body is used to (a
						slow 42-day average); fatigue is the last week (fast). Training with
						fatigue a little above fitness is what builds — far above it is
						where recovery earns more than riding.
					</p>
					<FitnessChart series={load.series} onpick={openDay} />
				</div>
			{/if}
		</div>

		<h2 class="eyebrow mt-10">every ride</h2>
	{/if}

	{#if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if rides === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 3 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else if rides.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md), and this one is about
		     the ACCOUNT's rides: gated on the device list too, a rider with
		     one device-only summary and no account ride got an empty <ul>
		     under no heading instead (#2181). The device section below says
		     its own piece either way. -->
		<div class="mt-8">
			<EmptyState>
				<p class="text-ink text-sm">No rides yet.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					Finish a workout and it lands here with its execution score. You can
					export any ride as a .fit for Strava or your head unit.
				</p>
				{#snippet cta()}
					<a href="/workouts" class="btn btn-primary">Ride solo</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		{@const failed = rides.filter(
			(ride) => ride.exportState === 'failed',
		).length}
		{#if failed > 0}
			<div class="mt-8">
				<Banner tone="warn">
					{failed === 1 ? 'One ride' : `${failed} rides`} could not be sent to Strava.
					Open a marked ride to try again.
				</Banner>
			</div>
		{/if}
		<ul class="mt-8 grid gap-2 xl:grid-cols-2">
			{#each rides as ride (ride.id)}
				{@render rideRow(ride, ride)}
			{/each}
		</ul>
		{#if more}
			<div class="mt-3">
				{#if moreError}
					<div class="mb-2">
						<Banner tone="error">
							{moreError}
							{#snippet action()}
								<button onclick={loadMore} class="btn-link text-xs"
									>Retry</button
								>
							{/snippet}
						</Banner>
					</div>
				{/if}
				<button
					onclick={loadMore}
					disabled={loadingMore}
					class="btn btn-secondary"
					>{loadingMore ? 'Loading…' : 'Load older rides'}</button
				>
			</div>
		{/if}
	{/if}

	{#if device.all.length > 0}
		<h2 class="eyebrow mt-10">on this device only</h2>
		<p class="text-muted mt-1 text-xs">
			Summaries the server did not take. A ride under a minute stays here; one
			that finished while the server was unreachable is offered above, and
			saving it moves it to your account.
		</p>
		<ul class="mt-3 grid gap-2 xl:grid-cols-2">
			{#each device.all as ride (ride.id)}
				{@render rideRow(ride)}
			{/each}
		</ul>
		<!-- The only copy there is: a confirm, as errors.md keeps for the
		     genuinely destructive (audit 2026-09-09). -->
		<button onclick={() => void clearDevice()} class="btn btn-danger mt-4"
			>Clear device rides</button
		>
	{/if}
</main>
