<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';

	const profile = createProfileStore();
	void account.load();

	// Decorative footer, not ride data: on failure it simply doesn't render.
	let version = $state<string | null>(null);
	void api<{ commit: string }>('/api/version').then((r) => {
		// ?. guards an old server answering with the SPA fallback (data: null).
		if (r.ok) version = r.data?.commit ?? null;
	});

	// WATTROOM.md: social OAuth only — no passwords, ever.
	const providerLabels: Record<string, { label: string; note?: string }> = {
		google: { label: 'Continue with Google' },
		github: { label: 'Continue with GitHub' },
		strava: {
			label: 'Continue with Strava',
			note: 'also connects ride upload',
		},
		dev: { label: 'Dev sign-in (local only)' },
	};
	const providerName: Record<string, string> = {
		google: 'Google',
		github: 'GitHub',
		strava: 'Strava',
		dev: 'Dev',
	};

	let name = $state('');
	let email = $state('');
	let notifyPlanned = $state(false);
	let ftp = $state(profile.current.ftp);
	let kg = $state(profile.current.kg);
	let sprintGrade = $state(profile.current.sprintGrade);
	let singleSpeed = $state(profile.current.singleSpeed);
	let status = $state<string | null>(null);
	let suggestionDismissed = $state(false);
	let confirmDelete = $state(false);
	let deleteConfirmation = $state('');
	let deleting = $state(false);

	// The root layout owns the server → localStorage pull; this only fills
	// the form fields.
	$effect(() => {
		const me = account.me;
		if (!me) return;
		ftp = me.ftpWatts;
		kg = me.weightKg;
		name = me.displayName;
		email = me.email ?? '';
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
				// server's current value.
				...(account.me.mailAvailable
					? { email: email.trim(), notifyPlanned }
					: {}),
			});
			status = err
				? err.message
				: (profile.update({ ftp: nextFtp, kg, sprintGrade, singleSpeed }) ??
					'Saved.');
			return;
		}
		status =
			profile.update({ ftp: nextFtp, kg, sprintGrade, singleSpeed }) ??
			'Saved.';
	}

	async function deleteAccount() {
		deleting = true;
		const res = await api('/api/me', { method: 'DELETE' });
		deleting = false;
		if (res.ok) {
			await account.signOut();
			location.href = '/';
		} else {
			status = 'The deletion did not complete. Nothing was removed.';
		}
	}

	const measured = $derived(profile.current.ftpMeasuredAt);
</script>

<main class="page max-w-2xl">
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
		<section class="panel mt-8 p-6">
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="eyebrow">display name</span>
					<input bind:value={name} maxlength="60" class="input mt-1 w-full" />
				</label>
				<div>
					<span class="eyebrow">signed in with</span>
					<p class="mt-2 text-sm">
						{(account.me?.providers ?? [])
							.map((p) => providerName[p] ?? p)
							.join(', ') || '—'}
					</p>
					{#if account.me?.providers?.includes('strava')}
						<label class="mt-3 flex items-start gap-2">
							<input
								type="checkbox"
								checked={account.me?.stravaUpload ?? true}
								onchange={(e) =>
									void account.save({
										displayName: name || (account.me?.displayName ?? ''),
										ftpWatts: ftp,
										weightKg: kg,
										stravaUpload: e.currentTarget.checked,
									})}
								class="mt-0.5"
							/>
							<span class="text-xs">
								Auto-upload rides to Strava
								<span class="text-muted block text-[11px]">
									Your rides, your Strava, as Virtual Rides. Upload only —
									nothing is ever pulled back.
								</span>
							</span>
						</label>
					{/if}
				</div>
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
						<span class="text-muted mt-1 block text-[11px]"
							>Only for the emails you ask for here — never shown to anyone.</span
						>
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

		<!-- Privacy is architecture: say what is true, not what sounds good. -->
		<section class="border-muted/15 mt-3 rounded-lg border p-6">
			<h2 class="font-display font-bold">Your data</h2>
			<ul class="text-muted mt-3 space-y-1.5 text-xs">
				<li>Rides are private by default — sharing is per ride, and opt-in.</li>
				<li>
					Live power is visible only inside a room, only while you're riding it.
				</li>
				<li>
					Voice and camera are never recorded. They pass through and are gone.
				</li>
				<li>Heart rate is health data and is treated as such.</li>
			</ul>
			<div class="mt-5 flex flex-wrap gap-2">
				<a href="/api/me/export" class="btn btn-secondary">Export everything</a>
				<button
					onclick={() => account.signOut()}
					class="text-muted hover:text-ink self-center text-xs underline"
					>Sign out</button
				>
			</div>

			<!-- The destructive action lives apart from the routine ones (#126). -->
			<div class="border-ink/5 mt-6 border-t pt-4">
				<button onclick={() => (confirmDelete = true)} class="btn btn-danger"
					>Delete account</button
				>
			</div>

			{#if confirmDelete}
				<!-- Confirmation dialogs are for the genuinely destructive only. -->
				<div class="border-z6/50 bg-z6/10 mt-4 rounded-lg border p-5">
					<p class="text-sm font-medium">
						This deletes everything, permanently.
					</p>
					<p class="text-muted mt-1.5 text-xs leading-relaxed">
						Every ride and its samples, your power curve, your XP, your medals
						and memberships. There is no undo and no backup we can restore from
						— that's the point of a full purge.
					</p>
					<label class="mt-4 block">
						<span class="text-muted text-[11px]">Type DELETE to confirm</span>
						<input
							bind:value={deleteConfirmation}
							class="input mt-1 w-full font-mono"
						/>
					</label>
					<div class="mt-3 flex gap-2">
						<button
							onclick={deleteAccount}
							disabled={deleteConfirmation !== 'DELETE' || deleting}
							class="btn btn-danger-solid">Delete my account</button
						>
						<button
							onclick={() => {
								confirmDelete = false;
								deleteConfirmation = '';
							}}
							class="btn btn-secondary">Cancel</button
						>
					</div>
				</div>
			{/if}
		</section>
	{/if}

	<footer class="text-muted/60 mt-10 text-center font-mono text-[11px]">
		<p>
			wattroom
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
			· by
			<a href="https://natron.io" class="hover:text-ink underline"
				>Natron Tech</a
			>
		</p>
	</footer>
</main>
