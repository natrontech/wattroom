<script lang="ts">
	/**
	 * The ramp's number and what to do with it (#1799): the FTP, the w/kg,
	 * Save / Test again / keep the old one, and the LTHR suggestion. Lifted
	 * out of the page, which had grown past the ceiling drawing the test and
	 * its result on one sheet. Owns the two saves: the account first, this
	 * browser second (#1543, #1571).
	 */
	import type { Snippet } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import { ftpFromRamp, RAMP } from '$lib/workout/ramp';
	import type { createRideSession } from '$lib/workout/session.svelte';

	let {
		session,
		stepsDone,
		onRestart,
		children,
	}: {
		session: ReturnType<typeof createRideSession>;
		stepsDone: number;
		onRestart: () => void;
		/** The ride's own line and the flags, from the page. */
		children: Snippet;
	} = $props();

	const profile = createProfileStore();
	let saved = $state(false);
	let lthrSaved = $state(false);
	let error = $state<string | null>(null);

	const result = $derived(ftpFromRamp(session.recording.map((s) => s.watts)));
	const wkg = $derived((result.ftp / profile.current.kg).toFixed(2));

	// LTHR suggestion (ADR-0014): a maximal ramp ends near HRmax, and the
	// SPEC's field estimate is 90 % of that. Suggested, never auto-applied —
	// the same posture as FTP suggestions.
	const maxHr = $derived(
		session.recording.reduce(
			(peak, sample) => Math.max(peak, sample.heartRate ?? 0),
			0,
		),
	);
	const suggestedLthr = $derived.by(() => {
		const estimate = Math.round(0.9 * maxHr);
		return estimate >= PROFILE_LIMITS.minLthr &&
			estimate <= PROFILE_LIMITS.maxLthr
			? estimate
			: 0;
	});
	// The account first, like the FTP below (#1571): the anchor used to live
	// in this browser alone, and the desktop app read "—" the same evening.
	async function saveLthr() {
		const message =
			(await pushProfile({ lthr: suggestedLthr })) ??
			profile.update({ lthr: suggestedLthr });
		if (message) error = message;
		else lthrSaved = true;
	}

	// The account first, this browser second (#1543): the other order
	// reported "Saved" on a push that never landed, and the next boot pulled
	// the old number back over the new one.
	async function saveFtp() {
		// 'ramp' is the provenance (#1484): this number was measured, so the
		// account stops labelling its FTP a starting guess even if the test
		// happens to land on the 200 W it was created with.
		const message =
			(await pushProfile({ ftpWatts: result.ftp, ftpSource: 'ramp' })) ??
			profile.update({ ftp: result.ftp, ftpMeasuredAt: Date.now() });
		if (message) error = message;
		else saved = true;
	}
</script>

<div class="panel mt-8 p-8">
	<p class="eyebrow">your new FTP</p>
	<div class="mt-2 flex items-baseline gap-2">
		<span
			class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
			>{result.ftp}</span
		>
		<span class="text-muted text-xl">W</span>
	</div>
	<p class="text-muted mt-4 text-xs leading-relaxed">
		Best minute was {result.best} W, and FTP is {Math.round(
			RAMP.ftpFraction * 100,
		)} % of that. You lasted {formatClock(session.elapsed)} — {stepsDone}
		steps. Every workout you ride from here scales to this number —
		<a href="/workouts" class="underline">the library</a>
		and <a href="/home" class="underline">what your rooms have planned</a> already
		do.
	</p>
	<p class="mt-3 text-sm">
		That's <span class={ZONE_TEXT[zoneOf(result.ftp, result.ftp)]}
			>{wkg} w/kg</span
		>
		at {profile.current.kg} kg.
	</p>
	{@render children()}

	{#if error}
		<div class="mt-4"><Banner tone="error">{error}</Banner></div>
	{/if}

	{#if saved}
		<p class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-sm">
			Saved. Every workout now scales to {result.ftp} W.
		</p>
		<a href="/workouts" class="btn btn-secondary mt-3">Pick a workout</a>
	{:else}
		<div class="mt-6 flex gap-2">
			<button
				onclick={saveFtp}
				disabled={result.ftp === 0}
				class="btn btn-primary">Save {result.ftp} W</button
			>
			<button onclick={onRestart} class="btn btn-secondary">Test again</button>
			<!-- Never silently change FTP: it moves every workout's difficulty. -->
			<a
				href="/settings/profile"
				class="text-muted hover:text-ink self-center py-2 text-xs underline"
				>Keep my current {profile.current.ftp} W</a
			>
		</div>
	{/if}

	{#if suggestedLthr > 0}
		<div class="border-ink/5 mt-6 border-t pt-4">
			{#if lthrSaved}
				<p class="text-z4 text-xs">
					LTHR set to {suggestedLthr} bpm — your heart-rate zones now follow it.
				</p>
			{:else}
				<p class="text-muted text-xs">
					Your heart rate peaked at {maxHr} bpm — that puts your LTHR around
					{suggestedLthr} bpm{profile.current.lthr
						? ` (currently ${profile.current.lthr})`
						: ''}.
				</p>
				<button onclick={saveLthr} class="btn btn-secondary btn-xs mt-2"
					>Set LTHR to {suggestedLthr}</button
				>
			{/if}
		</div>
	{/if}
</div>
