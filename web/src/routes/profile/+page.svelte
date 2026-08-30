<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
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
	});

	async function save(nextFtp = ftp) {
		ftp = nextFtp;
		if (account.me) {
			const err = await account.save({
				displayName: name || account.me.displayName,
				ftpWatts: nextFtp,
				weightKg: kg,
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
		const res = await fetch('/api/me', { method: 'DELETE' });
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

<main class="mx-auto max-w-2xl px-6 py-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-3xl font-bold tracking-tight">Profile</h1>
	</div>

	{#if !account.loaded}
		<p class="text-muted mt-8 text-sm">Loading…</p>
	{/if}

	{#if account.loaded}
		<section
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-6"
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>display name</span
					>
					<input
						bind:value={name}
						maxlength="60"
						class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 text-sm outline-none"
					/>
				</label>
				<div>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>signed in with</span
					>
					<p class="mt-2 text-sm">
						{(account.me?.providers ?? [])
							.map((p) => providerName[p] ?? p)
							.join(', ') || '—'}
					</p>
				</div>
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>FTP (W)</span
					>
					<input
						type="number"
						bind:value={ftp}
						min={PROFILE_LIMITS.minFtp}
						max={PROFILE_LIMITS.maxFtp}
						class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
					/>
					<span class="text-muted mt-1 block text-[11px]">
						Sets every workout's targets.
						{#if measured}
							Measured by a ramp test on {new Date(
								measured,
							).toLocaleDateString()}.
						{:else}
							<a href="/ramp" class="underline hover:text-white"
								>A ramp test measures it for you.</a
							>
						{/if}
					</span>
				</label>
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>weight (kg)</span
					>
					<input
						type="number"
						bind:value={kg}
						min={PROFILE_LIMITS.minKg}
						max={PROFILE_LIMITS.maxKg}
						class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>Only used for w/kg — the number every contest here is scored on.</span
					>
				</label>
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>sprint grade (%)</span
					>
					<input
						type="number"
						bind:value={sprintGrade}
						min="1"
						max="15"
						class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>The slope a sprint moment throws you onto.</span
					>
				</label>
				<label class="text-muted flex items-center gap-2 self-end pb-2 text-xs">
					<input type="checkbox" bind:checked={singleSpeed} />
					Single-speed setup (Zwift Cog)
				</label>
			</div>
			<div class="mt-5 flex items-center gap-3">
				<button
					onclick={() => save()}
					class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
					>Save</button
				>
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
				<a
					href="/api/me/export"
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
					>Export everything</a
				>
				<button
					onclick={() => account.signOut()}
					class="text-muted self-center text-xs underline hover:text-white"
					>Sign out</button
				>
			</div>

			<!-- The destructive action lives apart from the routine ones (#126). -->
			<div class="mt-6 border-t border-white/5 pt-4">
				<button
					onclick={() => (confirmDelete = true)}
					class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-4 py-2 text-sm"
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
							class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm outline-none"
						/>
					</label>
					<div class="mt-3 flex gap-2">
						<button
							onclick={deleteAccount}
							disabled={deleteConfirmation !== 'DELETE' || deleting}
							class="bg-z6 rounded px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
							>Delete my account</button
						>
						<button
							onclick={() => {
								confirmDelete = false;
								deleteConfirmation = '';
							}}
							class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
							>Cancel</button
						>
					</div>
				</div>
			{/if}
		</section>
	{/if}

	{#if version}
		<p class="text-muted/60 mt-10 text-center font-mono text-[11px]">
			wattroom {version}
		</p>
	{/if}
</main>
