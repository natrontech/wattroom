<script lang="ts">
	import Appearance from '$lib/profile/Appearance.svelte';
	import CoachAccess from '$lib/profile/CoachAccess.svelte';
	import Equipment from '$lib/profile/Equipment.svelte';
	import Notifications from '$lib/profile/Notifications.svelte';
	import VoiceAudio from '$lib/profile/VoiceAudio.svelte';
	import YourData from '$lib/profile/YourData.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import ProviderConnections from '$lib/components/ProviderConnections.svelte';
	import PasskeyList from '$lib/components/PasskeyList.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { AVATAR_PRESETS } from '$lib/avatars';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import { hrZoneRanges, ZONE_TEXT } from '$lib/components/zones';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';

	let { data }: { data: PageData } = $props();

	const profile = createProfileStore();

	// The FTP number's story (#222) — decorative context under the field, so
	// on failure it simply doesn't render.
	let trend = $state(untrack(() => data.trend));

	// Decorative footer, not ride data: on failure it simply doesn't render.
	// The release tag is the useful half now (#345); the commit stays for the
	// case where a build is not a release and reports "dev".
	let version = $state<string | null>(untrack(() => data.version));
	let release = $state<string | null>(untrack(() => data.release));

	let name = $state('');
	let email = $state('');
	let notifyPlanned = $state(false);
	let ftp = $state(profile.current.ftp);
	let kg = $state(profile.current.kg);

	// null = no anchor set; saving null clears it (ADR-0014, device-local).
	let lthr = $state<number | null>(profile.current.lthr ?? null);
	let sprintGrade = $state(profile.current.sprintGrade);
	let singleSpeed = $state(profile.current.singleSpeed);
	let status = $state<string | null>(null);
	let suggestionDismissed = $state(false);

	// The root layout owns the server → localStorage pull; this only fills
	// the form fields.
	$effect(() => {
		const me = account.me;
		if (!me) return;
		ftp = me.ftpWatts;
		kg = me.weightKg;
		name = me.displayName;
		// A pending address is the one the rider last asked for — show that,
		// not the confirmed one it is replacing (#781).
		email = me.emailPending ?? me.email ?? '';
		notifyPlanned = me.notifyPlanned ?? false;
	});

	async function save(nextFtp = ftp) {
		ftp = nextFtp;
		if (account.me) {
			const err = await account.save({
				displayName: name || account.me.displayName,
				ftpWatts: nextFtp,
				weightKg: kg,
				// Only where the section renders — an omitted field keeps the
				// server's current value. The address travels only when the
				// rider changed it: an unchanged one re-sent past the resend
				// window mints a new token and kills the link already in their
				// inbox, and a legacy unverified address was mailed on every
				// save (#824).
				...(account.me.mailAvailable
					? {
							...(email.trim() !==
							(account.me.emailPending ?? account.me.email ?? '')
								? { email: email.trim() }
								: {}),
							notifyPlanned,
						}
					: {}),
			});
			status = err
				? err.message
				: (profile.update({
						ftp: nextFtp,
						kg,
						sprintGrade,
						singleSpeed,
						lthr: lthr ?? undefined,
					}) ?? 'Saved.');
			return;
		}
		status =
			profile.update({
				ftp: nextFtp,
				kg,
				sprintGrade,
				singleSpeed,
				lthr: lthr ?? undefined,
			}) ?? 'Saved.';
	}

	const measured = $derived(profile.current.ftpMeasuredAt);

	// Level header facts (#253) — docs/SPEC.md thresholds via $lib/level.
	const xp = $derived(account.me?.totalXp ?? 0);
	const level = $derived(levelFromXp(xp));

	// Picking is reversible with one more click — save immediately, no confirm.
	async function pickAvatar(presetId: string) {
		if (!account.me) return;
		const err = await account.save({
			displayName: name || account.me.displayName,
			ftpWatts: ftp,
			weightKg: kg,
			avatarPreset: presetId,
		});
		if (err) status = err.message;
	}
</script>

<svelte:head><title>Profile · WattRoom</title></svelte:head>

<main class="page">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-3xl font-bold tracking-tight">Profile</h1>
	</div>

	{#if !account.loaded}
		<div class="panel mt-8 p-6">
			<Skeleton class="h-4 w-40" />
			<Skeleton class="mt-3 h-9" rows={3} />
		</div>
	{/if}

	{#if account.loaded}
		{#if account.me}
			<!-- Who you are here (#253): avatar, level, the road to the next. -->
			<section class="panel mt-8 p-6">
				<div class="flex items-center gap-6">
					<Avatar
						name={account.me.displayName}
						avatarUrl={account.me.avatarUrl}
						preset={account.me.avatarPreset}
						{xp}
						size={76}
					/>
					<div class="min-w-0 flex-1">
						<p class="eyebrow">level</p>
						<p
							class="font-display mt-0.5 text-3xl leading-none font-bold tabular-nums"
						>
							{level}
						</p>
						<ProgressBar
							pct={Math.round(levelProgress(xp) * 100)}
							h="h-1"
							fill="bg-neon"
							class="mt-3 max-w-60"
						/>
						<p class="text-muted mt-1.5 font-mono text-[11px] tabular-nums">
							{xp.toLocaleString()} XP · {(
								xpForLevel(level + 1) - xp
							).toLocaleString()} to level {level + 1}
						</p>
					</div>
				</div>
				<div class="border-ink/5 mt-5 border-t pt-4">
					<span class="eyebrow">avatar</span>
					<div class="mt-2.5 flex flex-wrap items-center gap-2">
						<button
							onclick={() => void pickAvatar('')}
							class="rounded-full border-2 p-0.5 transition-colors {!account.me
								.avatarPreset
								? 'border-neon'
								: 'hover:border-muted/40 border-transparent'}"
							title={account.me.avatarUrl
								? 'your sign-in photo'
								: 'your initial'}
							aria-label="use your default avatar"
						>
							<Avatar
								name={account.me.displayName}
								avatarUrl={account.me.avatarUrl}
								size={32}
							/>
						</button>
						{#each AVATAR_PRESETS as preset (preset.id)}
							<button
								onclick={() => void pickAvatar(preset.id)}
								class="rounded-full border-2 p-0.5 transition-colors {account.me
									.avatarPreset === preset.id
									? 'border-neon'
									: 'hover:border-muted/40 border-transparent'}"
								title={preset.id}
								aria-label="pick the {preset.id} avatar"
							>
								<Avatar name={preset.id} preset={preset.id} size={32} />
							</button>
						{/each}
					</div>
				</div>
			</section>
		{/if}

		<section class="panel mt-3 p-6">
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="eyebrow">display name</span>
					<input bind:value={name} maxlength="60" class="input mt-1 w-full" />
				</label>
				<ProviderConnections
					onUploadToggle={(on) =>
						void account.save({
							displayName: name || (account.me?.displayName ?? ''),
							ftpWatts: ftp,
							weightKg: kg,
							stravaUpload: on,
						})}
				/>
				<PasskeyList />
				<label class="block">
					<span class="eyebrow">FTP (W)</span>
					<input
						type="number"
						bind:value={ftp}
						min={PROFILE_LIMITS.minFtp}
						max={PROFILE_LIMITS.maxFtp}
						class="input mt-1 w-full font-mono tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]">
						Sets every workout's targets.
						{#if measured}
							Measured by a ramp test on {new Date(
								measured,
							).toLocaleDateString()}.
						{:else}
							<a href="/ramp" class="hover:text-ink underline"
								>A ramp test measures it for you.</a
							>
						{/if}
					</span>
					{#if trend.length >= 2}
						<span class="mt-3 block">
							<FtpTrendChart rides={trend} height={150} />
						</span>
					{/if}
				</label>
				<label class="block">
					<span class="eyebrow">weight (kg)</span>
					<input
						type="number"
						bind:value={kg}
						min={PROFILE_LIMITS.minKg}
						max={PROFILE_LIMITS.maxKg}
						class="input mt-1 w-full font-mono tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>Only used for w/kg — the number every contest here is scored on.</span
					>
				</label>
				<label class="block">
					<span class="eyebrow">LTHR (bpm)</span>
					<input
						type="number"
						bind:value={lthr}
						min={PROFILE_LIMITS.minLthr}
						max={PROFILE_LIMITS.maxLthr}
						placeholder="—"
						class="input mt-1 w-full font-mono tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]">
						Threshold heart rate — anchors your HR zones the way FTP anchors
						power zones.
						{#if !lthr}
							<a href="/ramp" class="hover:text-ink underline"
								>A ramp test with a strap suggests one.</a
							>
						{/if}
					</span>
				</label>
				{#if lthr && lthr >= PROFILE_LIMITS.minLthr && lthr <= PROFILE_LIMITS.maxLthr}
					<div class="sm:col-span-2">
						<span class="eyebrow">your heart-rate zones</span>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each hrZoneRanges(lthr) as range (range.zone)}
								<span
									class="border-muted/15 bg-surface-raised rounded-full border px-3 py-1.5 text-[11px]"
								>
									<span class="{ZONE_TEXT[range.zone]} font-semibold"
										>Z{range.zone}</span
									>
									<span class="text-muted ml-1">{range.name}</span>
									<span class="ml-1 font-mono tabular-nums"
										>{range.zone === 1
											? `≤ ${range.high}`
											: range.high !== undefined
												? `${range.low}–${range.high}`
												: `${range.low}+`}</span
									>
								</span>
							{/each}
						</div>
						<p class="text-muted mt-1.5 text-[11px]">
							Derived from your LTHR (Coggan levels) — they colour your own bpm
							only, and are never scored.
						</p>
					</div>
				{/if}
				<label class="block">
					<span class="eyebrow">sprint grade (%)</span>
					<input
						type="number"
						bind:value={sprintGrade}
						min="1"
						max="15"
						class="input mt-1 w-full font-mono tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>The slope a sprint moment throws you onto.</span
					>
				</label>
				<label class="text-muted flex items-center gap-2 self-end pb-2 text-xs">
					<input type="checkbox" bind:checked={singleSpeed} />
					Single-speed setup (Zwift Cog)
				</label>
				{#if account.me?.mailAvailable}
					<label class="block">
						<span class="eyebrow">email</span>
						<input
							type="email"
							bind:value={email}
							maxlength="254"
							class="input mt-1 w-full"
						/>
						{#if account.me?.emailPending}
							<span class="text-muted mt-1 block text-[11px]">
								Waiting on the link sent to {account.me.emailPending} — it works once
								and expires in a day.
							</span>
						{:else if account.me?.emailVerified}
							<span class="text-z4 mt-1 block text-[11px]">
								Confirmed — this is how you get back in if you lose the way you
								sign in.
							</span>
						{:else}
							<span class="text-muted mt-1 block text-[11px]">
								Save it and we send a link to confirm. It is how you recover
								this account, and it is never shown to anyone.
							</span>
						{/if}
					</label>
					<div class="self-end pb-2">
						<label class="text-muted flex items-start gap-2 text-xs">
							<input
								type="checkbox"
								bind:checked={notifyPlanned}
								disabled={!email.trim()}
								class="mt-0.5"
							/>
							<span>
								Email me when a session is planned
								{#if !email.trim()}
									<span class="text-muted block text-[11px]"
										>Needs an email address first.</span
									>
								{/if}
							</span>
						</label>
					</div>
				{/if}
			</div>
			<div class="mt-5 flex items-center gap-3">
				<button onclick={() => save()} class="btn btn-primary">Save</button>
				{#if status}<span class="text-muted text-xs">{status}</span>{/if}
			</div>
		</section>

		{#if account.me?.suggestedFtp && !suggestionDismissed}
			<div class="mt-3">
				<FtpPrompt
					current={account.me.ftpWatts}
					suggested={account.me.suggestedFtp}
					best20={account.me.best20m ?? 0}
					onApply={() => {
						void save(account.me?.suggestedFtp ?? ftp);
						suggestionDismissed = true;
					}}
					onKeep={() => (suggestionDismissed = true)}
				/>
			</div>
		{/if}

		<Appearance />
		<Notifications />

		<!-- Coach access (ADR-0017): read-only tokens for your own AI/tools. -->
		<CoachAccess initial={data.tokens} />

		<!-- Privacy is architecture: say what is true, not what sounds good. -->
		<!-- ADR-0020 moved these off the rail — they were living in a 208 px
		     strip you also navigate rooms with. The gate and the mix turned out
		     to be reached for mid-ride after all (#477), so the room carries a
		     Sound panel with the same GateTune and MixFaders on it. This page
		     stays the whole thing: the panel is the shortcut, not the home. -->
		<VoiceAudio />

		<Equipment />

		<YourData onError={(m) => (status = m)} />
	{/if}

	<footer class="text-muted/60 mt-10 text-center font-mono text-[11px]">
		<p>
			wattroom
			{#if release}
				<a href="/whats-new" class="hover:text-ink underline">{release}</a>
			{/if}
			{#if version && version !== 'dev'}
				<!-- +dirty is display-only; the commit link needs the bare sha. -->
				<a
					href="https://github.com/natrontech/wattroom/commit/{version.replace(
						'+dirty',
						'',
					)}"
					class="hover:text-ink underline">{version}</a
				>
			{:else if version}
				{version}
			{/if}
		</p>
		<p class="mt-1">
			free &amp; open source (AGPL) —
			<a
				href="https://github.com/natrontech/wattroom"
				class="hover:text-ink underline">GitHub</a
			>
			· <a href="/download" class="hover:text-ink underline">desktop app</a>
			· by
			<a href="https://natron.io" class="hover:text-ink underline"
				>Natron Tech</a
			>
		</p>
	</footer>
</main>
