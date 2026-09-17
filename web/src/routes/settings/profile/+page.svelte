<script lang="ts">
	import { confirm } from '$lib/confirm.svelte';
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
	import { account, unchosen } from '$lib/account.svelte';
	import { EMAIL_IS_FOR } from '$lib/auth/address';
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
	let ftp = $state(profile.current.ftp);
	let kg = $state(profile.current.kg);

	// null = no anchor set; saving null clears it (ADR-0014, device-local).
	let lthr = $state<number | null>(profile.current.lthr ?? null);
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
	//
	// ONCE, guarded the way VerifyEmailGate guards its address: a later `me`
	// refresh cannot overwrite what the rider is typing (#2165). `me` is
	// replaced by things that are not this form — a picture upload, a
	// provider disconnect, a save from another panel — and each of them used
	// to put the server's numbers back over a typed FTP with no sign that
	// anything had happened. A save sets these fields itself, from what was
	// sent, so nothing needs re-filling after one.
	let filled = false;
	$effect(() => {
		const me = account.me;
		if (!me || filled) return;
		filled = true;
		ftp = me.ftpWatts;
		// The anchor follows the account too (#1571); an account without one
		// leaves whatever this browser holds until the pull pushes it up.
		if (me.lthr != null) lthr = me.lthr;
		kg = me.weightKg;
		name = me.displayName;
		// A pending address is the one the rider last asked for — show that,
		// not the confirmed one it is replacing (#781).
		email = me.emailPending ?? me.email ?? '';
	});

	async function save(nextFtp = ftp) {
		ftp = nextFtp;
		if (account.me) {
			// An emptied field is not a tidy-up (#1828): it removes the only
			// way back in and every account alarm, with no undo. The confirm
			// delete-room and delete-account get, in the same words.
			const had = account.me.emailPending ?? account.me.email ?? '';
			if (account.me.mailAvailable && had && email.trim() === '') {
				const ok = await confirm({
					title: 'Remove your recovery address?',
					body: 'Without it there is no way back into this account if every passkey and sign-in provider is lost, and no more account alarms. Adding one again means confirming a new link.',
					action: 'Remove the address',
					cancel: 'Keep it',
				});
				if (!ok) {
					email = had;
					return;
				}
			}
			const err = await account.save({
				// What the rider typed, not a fallback (#2166): `name ||
				// account.me.displayName` meant emptying the field said
				// "Saved." and refilled the old name, which is a refusal the
				// rider never saw. The server's "1-60 characters" reaches the
				// field now.
				displayName: name,
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
				...(account.me.mailAvailable &&
				email.trim() !== (account.me.emailPending ?? account.me.email ?? '')
					? { email: email.trim() }
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
						lthr: lthr ?? undefined,
					}) ?? 'Saved.');
			return;
		}
		status =
			profile.update({
				ftp: nextFtp,
				kg,
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
	// A refusal about the picture belongs under the picture (errors.md), not
	// on the Save button's status line two panels down, in the same muted grey
	// as "Saved." — which is the mistake this file's own comment above
	// rejects, made again on a different control (#2166).
	let pictureError = $state<string | null>(null);
	async function pickPicture(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploading = true;
		pictureError = null;
		const image = await compressImage(file, 512);
		const err = image
			? await account.setAvatar(image)
			: { message: 'That file could not be read as a picture.' };
		uploading = false;
		pictureError = err ? err.message : null;
		status = err ? null : 'Picture saved.';
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
					{#if pictureError}
						<span class="text-danger mt-2 block text-xs">{pictureError}</span>
					{/if}
				</div>
			</section>
		{/if}

		{#if saveError}
			<div class="mt-3">
				<Banner tone="error">{saveError.message}</Banner>
			</div>
		{/if}
		<!-- Field-level, under the field it names (errors.md). The server says
		     which one — displayName, ftpWatts, weightKg, lthr, email — and the
		     form drew it for displayName alone, so four of the five refusals
		     appeared only in the banner above, away from the box to fix
		     (#2166). One snippet, so a sixth field cannot be forgotten
		     differently from the other five. -->
		{#snippet fieldError(field: string)}
			{#if saveError?.field === field}
				<span class="text-danger mt-1 block text-xs">{saveError.message}</span>
			{/if}
		{/snippet}
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
					{@render fieldError('displayName')}
				</label>
				<ProviderConnections
					onUploadToggle={async (on) => {
						// The account's stored values, not the form's live ones,
						// the way Notifications sends them (#2165): a checkbox
						// commits a checkbox. It used to PATCH whatever was in
						// the name, FTP and weight boxes — so ticking it saved
						// edits the rider had not pressed Save on, and a
						// half-typed FTP made the checkbox fail with an FTP
						// error about a field nobody had submitted.
						const me = account.me;
						if (!me) return null;
						// The refusal goes back to the checkbox (#2181), not into
						// this form's banner: it is the box that is wrong now.
						const err = await account.save({
							displayName: me.displayName,
							ftpWatts: me.ftpWatts,
							weightKg: me.weightKg,
							stravaUpload: on,
						});
						return err?.message ?? null;
					}}
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
				<!-- The chart is a SIBLING of the label, not inside it (#2181):
				     a label passes a click to its control, so tapping the trend
				     raised a numeric keyboard on a phone. -->
				<div>
					<label class="block">
						<span class="eyebrow">FTP (W)</span>
						<input
							type="number"
							bind:value={ftp}
							min={PROFILE_LIMITS.minFtp}
							max={PROFILE_LIMITS.maxFtp}
							aria-invalid={saveError?.field === 'ftpWatts'
								? 'true'
								: undefined}
							class="input num mt-1 w-full"
						/>
						{@render fieldError('ftpWatts')}
						<span class="text-muted mt-1 block text-[11px]">
							Sets every workout's targets.
							{#if measured}
								Measured by a ramp test on {new Date(
									measured,
								).toLocaleDateString()}.
							{:else}
								{#if unchosen(account.me?.ftpSource)}
									<!-- Said where it is fixed, too (#1484): the field
								     showed 200 W with nothing to say nobody chose it. -->
									This 200 W is where we start everyone, not a measurement.
								{/if}
								<a href="/ramp" class="hover:text-ink underline"
									>A ramp test measures it for you.</a
								>
							{/if}
						</span>
					</label>
					{#if trend.length >= 2}
						<div class="mt-3">
							<FtpTrendChart rides={trend} height={150} />
						</div>
					{/if}
				</div>
				<label class="block">
					<span class="eyebrow">weight (kg)</span>
					<input
						type="number"
						bind:value={kg}
						min={PROFILE_LIMITS.minKg}
						max={PROFILE_LIMITS.maxKg}
						aria-invalid={saveError?.field === 'weightKg' ? 'true' : undefined}
						class="input num mt-1 w-full"
					/>
					{@render fieldError('weightKg')}
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
						aria-invalid={saveError?.field === 'lthr' ? 'true' : undefined}
						class="input num mt-1 w-full"
					/>
					{@render fieldError('lthr')}
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
									<span class="num ml-1"
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
				{#if account.me?.mailAvailable}
					<label class="block">
						<span class="eyebrow">email</span>
						<input
							type="email"
							bind:value={email}
							maxlength="254"
							aria-invalid={saveError?.field === 'email' ? 'true' : undefined}
							class="input mt-1 w-full"
						/>
						{@render fieldError('email')}
						{#if account.me?.emailPending}
							<span class="text-muted mt-1 block text-[11px]">
								Waiting on the link sent to {account.me.emailPending} — it works once
								and expires in a day.
							</span>
						{:else if account.me?.emailVerified}
							<span class="text-z4 mt-1 block text-[11px]"
								>Confirmed. {EMAIL_IS_FOR}</span
							>
						{:else}
							<span class="text-muted mt-1 block text-[11px]">
								Save it and we send a link to confirm. {EMAIL_IS_FOR}
							</span>
						{/if}
						<!-- What the address is used for beyond recovery lives with
						     the other notifications (#1828), not in the profile form. -->
						<span class="text-muted mt-1 block text-[11px]"
							>Whether a planned session mails you is on <a
								href="/settings/notifications"
								class="btn-link">Notifications</a
							>.</span
						>
					</label>
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
