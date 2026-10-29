<script lang="ts">
	/**
	 * The ride dock (ADR-0093 point 5, TARGETS ride-dock): the ride alone
	 * while it runs and no riding screen draws it, below the call and above
	 * you. Where it shows, its time, its live watts, the block and its target
	 * when a workout drives, its critical status with the one button that
	 * mends it, then Open and End ride. `short`: a phone's top bar, time and
	 * watts in one 44 px tap back to the ride.
	 */
	import { createPairAgain } from '$lib/ble/pair-again.svelte';
	import { formatClock } from '$lib/format';
	import { navDrawer } from '$lib/nav/drawer.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { dockShows } from '$lib/ride/ride-screens';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import { blockLabel } from '$lib/workout/block';
	import { isOpenRoad } from '$lib/workout/ridden';
	import { rideDock } from './ride-dock.svelte';

	let { pathname, short = false }: { pathname: string; short?: boolean } =
		$props();

	const profile = createProfileStore();
	const shows = $derived(dockShows(theRide.live, pathname));
	// Your own workout in a voice channel drives a block too (#4259).
	const session = $derived(
		theRide.session ??
			(theRide.channel?.ownRide.riding
				? theRide.channel.ownRide.session
				: null),
	);
	// While a workout drives: a free ride, or a road with no workout on it
	// (#4277), has no block.
	const block = $derived.by(() => {
		if (!session || isOpenRoad(session.workout)) return null;
		const label = blockLabel(
			session.info.segment,
			session.workout,
			profile.current.ftp,
		);
		const target = Math.round(session.target);
		return [label, target > 0 && `${target} W`].filter(Boolean).join(' · ');
	});
	const status = $derived(rideDock.status);
	const pair = createPairAgain((next) => rideDock.repair(next));
	const watts = $derived(rideDock.stale ? 'text-muted' : 'text-watt glow-text');

	// The sidebar's dock is mounted on every framed page, so it is the one
	// that remembers which riding screen Open goes back to.
	$effect(() => {
		if (!short) rideDock.saw(pathname);
	});
</script>

<!-- Under the open drawer the dock is the one watts figure (D17). -->
{#if short}
	{#if shows && !navDrawer.open}
		<a
			href={rideDock.screen}
			data-testid="ride-dock-short"
			aria-label="Open your ride"
			title={status?.text}
			class="hover:bg-ink/5 -my-1 ml-auto flex h-11 shrink-0 items-center gap-2 rounded px-2"
		>
			{#if status?.alert}
				<span class="bg-danger size-2 shrink-0 rounded-full"></span>
			{/if}
			<span class="num text-muted text-sm">{formatClock(rideDock.seconds)}</span
			>
			<!-- The unit beside the numeral, never inside its glow (G2). -->
			<span class="flex items-baseline gap-1">
				<span class="num font-bold {watts}">{rideDock.watts}</span>
				<span class="text-muted text-xs">W</span>
			</span>
		</a>
	{/if}
{:else if shows}
	<section
		aria-label="Your ride"
		data-testid="ride-dock"
		class="border-ink/5 border-t px-3 pt-2 pb-3"
	>
		<!-- Where the ride shows: today a ride alone is private (ADR-0093
		     point 6); the voice channel it shows in names itself here. -->
		<div class="flex min-w-0 items-center gap-2">
			<span class="eyebrow min-w-0 truncate">Riding alone</span>
			<span
				data-testid="ride-dock-time"
				class="num text-ink ml-auto shrink-0 text-xs"
				>{formatClock(rideDock.seconds)}</span
			>
		</div>
		<div class="flex min-w-0 items-baseline gap-1 pt-1">
			<span
				data-testid="ride-dock-watts"
				class="num text-2xl leading-none font-bold {watts}"
				>{rideDock.watts}</span
			>
			<span class="text-muted text-xs">W</span>
			{#if block}
				<span class="text-muted ml-auto min-w-0 truncate pl-2 text-xs"
					>{block}</span
				>
			{/if}
		</div>
		{#if status}
			<div
				class="flex min-w-0 items-center gap-2 pt-2"
				role={status.alert ? 'alert' : 'status'}
			>
				<span
					class="size-2 shrink-0 rounded-full {status.alert
						? 'bg-danger'
						: 'bg-z5'}"
				></span>
				<!-- A failed pairing speaks for the trainer's line alone. -->
				<p class="min-w-0 text-xs">
					{(status.action && pair.error) || status.text}
				</p>
			</div>
			{#if status.action}
				<button
					onclick={() => void pair.run()}
					disabled={pair.busy}
					aria-label={status.name}
					title={status.name}
					class="btn btn-secondary btn-xs mt-2 w-full max-md:min-h-11"
					>{pair.busy ? 'Pairing…' : status.action}</button
				>
			{/if}
		{/if}
		<div class="flex gap-2 pt-2">
			<a
				href={rideDock.screen}
				class="btn btn-secondary btn-xs flex-1 max-md:min-h-11">Open</a
			>
			<button
				onclick={() => void rideDock.end()}
				class="btn btn-secondary btn-xs flex-1 max-md:min-h-11">End ride</button
			>
		</div>
	</section>
{/if}
