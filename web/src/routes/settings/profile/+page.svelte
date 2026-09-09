<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import {
		declineFtp,
		declinedFtp,
		suggestionDeclined,
	} from '$lib/ftp-decline';
	import ProviderConnections from '$lib/components/ProviderConnections.svelte';
	import PasskeyList from '$lib/components/PasskeyList.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { api } from '$lib/api';
	import { compressImage } from '$lib/chat/media';
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
	let saveError = $state<{ message: string; field?: string } | null>(null);
	let signingOut = $state(false);
	async function signOutElsewhere() {
		signingOut = true;
		const res = await api<{ signedOut: number }>(
			'/api/auth/logout-everywhere',
			{
				method: 'POST',
			},
		);
		signingOut = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		const n = res.data.signedOut;
		toasts.push(
			n === 0
				? 'No other device was signed in.'
				: `Signed out on ${n} other ${n === 1 ? 'device' : 'devices'}.`,
		);
	}
	// The decline outlives the visit (#1552), keyed on the suggested value.
	let declined = $state(declinedFtp());
	let applied = $state(false);
	const suggestionDismissed = $derived(
		applied || suggestionDeclined(account.me?.suggestedFtp, declined),
	);

	// The root layout owns the server → localStorage pull; this only fills
	// the form fields.
	$effect(() => {
		const me = account.me;
		if (!me) return;
		ftp = me.ftpWatts;
		// The anchor follows the account too (#1571); an account without one
		// leaves whatever this browser holds until the pull pushes it up.
		if (me.lthr != null) lthr = me.lthr;
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
				// On the account since #1571; an empty field clears it.
				lthr: lthr ?? 0,
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
			// A refusal is not a status line (errors.md): it used to read
			// exactly like "Saved." in the same muted grey, and the field it
			// named was thrown away (audit 2026-09-09).
			saveError = err;
			status = err
				? null
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

	// The rider's own picture (#1353). Shrunk here first: a phone photo is
	// several MB and the server caps an upload at 2; an avatar never draws
	// above 76px, so 512 on the long edge is plenty.
	let uploading = $state(false);
	async function pickPicture(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploading = true;
		const image = await compressImage(file, 512);
		const err = image
			? await account.setAvatar(image)
			: { message: 'That file could not be read as a picture.' };
		uploading = false;
		status = err ? err.message : 'Picture saved.';
	}
</script>

<!-- The Profile section of Settings (#1330): who you are and the numbers
     every ride scales from. The other sections are routes beside this one. -->
<div>
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
					<span class="eyebrow" id="picture-label">picture</span>
					<div class="mt-2.5 flex flex-wrap items-center gap-3">
						<label class="btn btn-secondary btn-xs cursor-pointer">
							{uploading
								? 'Uploading…'
								: account.me.avatarUrl
									? 'Replace picture'
									: 'Upload a picture'}
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								onchange={pickPicture}
								disabled={uploading}
								class="sr-only"
								aria-labelledby="picture-label"
							/>
						</label>
						<span class="text-muted text-[11px]"
							>PNG, JPEG, WebP or GIF. Shown wherever you are.</span
						>
					</div>
				</div>
			</section>
		{/if}

		{#if saveError}
			<div class="mt-3">
				<Banner tone="error">{saveError.message}</Banner>
			</div>
		{/if}
		<section class="panel mt-3 p-6">
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="eyebrow">display name</span>
					<input
						bind:value={name}
						maxlength="60"
						aria-invalid={saveError?.field === 'displayName'
							? 'true'
							: undefined}
						class="input mt-1 w-full"
					/>
					{#if saveError?.field === 'displayName'}
						<span class="text-danger mt-1 block text-xs"
							>{saveError.message}</span
						>
					{/if}
				</label>
				<ProviderConnections
					onUploadToggle={(on) =>
						void account
							.save({
								displayName: name || (account.me?.displayName ?? ''),
								ftpWatts: ftp,
								weightKg: kg,
								stravaUpload: on,
							})
							.then((err) => (saveError = err))}
				/>
				<!-- The response to "a passkey was added to your account" (ADR-0030,
				     #1607): every other screen signed out, this one kept. -->
				<div class="text-muted self-end pb-2 text-xs sm:col-span-2">
					<button
						onclick={signOutElsewhere}
						disabled={signingOut}
						class="btn btn-secondary btn-xs">Sign out everywhere else</button
					>
					<span class="ml-2"
						>Every other browser and device signed in to this account is signed
						out; this one stays.</span
					>
				</div>
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
						applied = true;
					}}
					onKeep={() => {
						const kept = account.me?.suggestedFtp ?? 0;
						declineFtp(kept);
						declined = kept;
					}}
				/>
			</div>
		{/if}
	{/if}
</div>
