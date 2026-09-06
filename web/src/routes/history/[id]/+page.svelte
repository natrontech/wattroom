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
	import { formatClock, formatDuration } from '$lib/format';
	import { MEDAL_META, medalName } from '$lib/medals';
	import DeleteRideDialog from '$lib/ride/DeleteRideDialog.svelte';
	import { fetchRide, type RideDetail } from '$lib/ride/detail';
	import { apiBlob } from '$lib/api';
	import { zoneSeconds } from '$lib/ride/stats';
	import { ArrowLeft, Award, Download, Trash2 } from '@lucide/svelte';

	const id = $derived(page.params.id ?? '');
	let ride = $state<RideDetail | null>(null);
	let error = $state<string | null>(null);
	// A ride that is not yours reads as absent, and retrying will not find it —
	// so it gets the empty state, not the error-with-retry one.
	let missing = $state(false);
	let confirming = $state(false);
	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	async function downloadFit() {
		if (!ride || ride.samples.length === 0) return;
		exporting = true;
		exportError = null;
		const res = await apiBlob(`/api/rides/${encodeURIComponent(id)}/export`);
		if (res.ok) {
			const url = URL.createObjectURL(res.data.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = res.data.filename ?? `wattroom-${id}.fit`;
			a.click();
			URL.revokeObjectURL(url);
		} else exportError = res.error.message;
		exporting = false;
	}

	async function load(which: string) {
		const res = await fetchRide(which);
		if (res.ok) {
			ride = res.data;
			error = null;
			missing = false;
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
		exportError = null;
		if (which) void load(which);
	});

	const zones = $derived(ride ? zoneSeconds(ride.samples, ride.ftp) : []);
	const trace = $derived(
		ride
			? ride.samples.map((sample, second) => ({ t: second, w: sample.watts }))
			: [],
	);
	const stats = $derived(
		ride
			? [
					{ label: 'duration', value: formatClock(ride.seconds) },
					{ label: 'work', value: `${ride.kj} kJ` },
					{ label: 'average', value: `${ride.avgWatts} W` },
					{ label: 'normalised', value: `${ride.normWatts} W` },
					{ label: 'execution', value: `${Math.round(ride.execution * 100)}%` },
					{ label: 'earned', value: `${ride.xp} XP` },
				]
			: [],
	);
</script>

<main class="page">
	<a
		href="/history"
		class="text-muted hover:text-ink inline-flex items-center gap-1.5 text-xs"
	>
		<ArrowLeft size={14} /> Rides
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
					<button
						onclick={() => void load(id)}
						class="text-muted hover:text-ink text-xs underline">Retry</button
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
		<header class="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
			<div>
				<h1 class="font-display text-2xl leading-tight font-bold">
					{ride.workoutName}
				</h1>
				<p class="text-muted mt-0.5 text-xs">
					{new Date(ride.startedAt).toLocaleString()} · {formatDuration(
						ride.seconds,
					)}
					{#if ride.room}
						· in <a
							href="/r/{ride.room.slug}"
							class="hover:text-ink underline underline-offset-2"
							>{ride.room.name}</a
						>
					{:else}
						· solo
					{/if}
				</p>
			</div>
			<button
				onclick={() => void downloadFit()}
				disabled={exporting || ride.samples.length === 0}
				class="btn btn-secondary btn-xs ml-auto disabled:opacity-50"
			>
				<Download size={13} />
				{exporting ? 'Preparing…' : 'Download FIT'}
			</button>
			<button onclick={() => (confirming = true)} class="btn btn-danger btn-xs">
				<Trash2 size={13} /> Delete ride
			</button>
		</header>
		{#if exportError}<div class="mt-3">
				<Banner tone="error">
					{exportError}
					{#snippet action()}<button
							class="text-xs underline"
							onclick={() => void downloadFit()}>Retry</button
						>{/snippet}
				</Banner>
			</div>
		{:else if ride.samples.length === 0}
			<p class="text-muted mt-3 text-xs">
				No samples were stored for this ride, so there is no FIT file to
				download.
			</p>
		{/if}

		<section class="panel mt-6 px-6 py-5">
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

		<section class="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
			{#each stats as stat (stat.label)}
				<div class="panel p-5">
					<div
						class="font-display text-2xl leading-none font-bold tabular-nums"
					>
						{stat.value}
					</div>
					<div class="eyebrow mt-2">{stat.label}</div>
				</div>
			{/each}
		</section>

		{#if zones.some((seconds) => seconds > 0)}
			<section class="panel mt-3 px-6 py-5">
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
						<li class="panel flex items-center gap-2.5 px-4 py-3">
							<Award size={18} class="text-neon shrink-0" />
							<span class="min-w-0">
								<span class="block truncate text-xs font-medium"
									>{medalName(medal.kind)}</span
								>
								<span class="text-muted block text-[10px]">
									{MEDAL_META[medal.kind]?.criterion ?? medal.roomName}
								</span>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if ride.export}
			<!-- #799: a rider who turned auto-upload on has had no way to know
			     whether the ride actually arrived. Delivery is durable now, so
			     the page can simply say. -->
			<section class="mt-3">
				<h2 class="eyebrow">where it went</h2>
				<p class="panel text-muted mt-3 px-4 py-3 text-xs">
					{#if ride.export.state === 'delivered'}
						On Strava{#if ride.export.remoteId}
							as
							<a
								class="underline"
								href="https://www.strava.com/activities/{ride.export.remoteId}"
								target="_blank"
								rel="noreferrer noopener">activity {ride.export.remoteId}</a
							>{/if}.
					{:else if ride.export.state === 'pending'}
						Waiting to reach Strava — it is retried on its own, nothing to do.
					{:else}
						Could not be sent to Strava.
						{ride.export.error ?? ''} Your ride is safe here; reconnect Strava in
						your profile if you disconnected it.
					{/if}
				</p>
			</section>
		{/if}

		{#if confirming}
			<DeleteRideDialog
				{ride}
				onclose={() => (confirming = false)}
				ondeleted={() => void goto('/history')}
			/>
		{/if}
	{/if}
</main>
