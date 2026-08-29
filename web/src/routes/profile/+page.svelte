<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import { account } from '$lib/account.svelte';

	const profile = createProfileStore();
	void account.load();

	// WATTROOM.md: social OAuth only. Labels here, ids from the server — a
	// provider without configured credentials never renders a button.
	const providerLabels: Record<string, string> = {
		google: 'Continue with Google',
		github: 'Continue with GitHub',
		strava: 'Continue with Strava',
		dev: 'Dev sign-in (local only)',
	};

	// Signed in, the server copy wins: it syncs into localStorage so /ride and
	// /ramp keep reading the local profile and never need to know accounts
	// exist, and into the fields so the screen shows what was synced.
	$effect(() => {
		const me = account.me;
		if (!me) return;
		profile.update({ ftp: me.ftpWatts, kg: me.weightKg });
		ftp = me.ftpWatts;
		kg = me.weightKg;
	});

	async function saveAccount() {
		const err = await account.save({
			displayName: account.me?.displayName ?? '',
			ftpWatts: ftp,
			weightKg: kg,
		});
		status = err
			? err.message
			: (profile.update({ ftp, kg, sprintGrade, singleSpeed }) ?? 'Saved.');
	}
	let ftp = $state(profile.current.ftp);
	let kg = $state(profile.current.kg);
	let status = $state<string | null>(null);
	let suggestionDismissed = $state(false);
	let sprintGrade = $state(profile.current.sprintGrade);
	let singleSpeed = $state(profile.current.singleSpeed);

	const measured = $derived(profile.current.ftpMeasuredAt);

	function save() {
		if (account.me) {
			void saveAccount();
			return;
		}
		status = profile.update({ ftp, kg, sprintGrade, singleSpeed }) ?? 'Saved.';
	}
</script>

<main class="mx-auto max-w-md px-6 py-10">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<h1 class="font-display text-2xl leading-tight font-bold">Profile</h1>
	</div>
	{#if account.me}
		<p class="text-muted mt-2 text-xs">
			Signed in as {account.me.displayName}. Your profile is stored with your
			account.
		</p>
		{#if account.me.suggestedFtp && !suggestionDismissed}
			<!-- Prompted, never auto-applied: FTP moves every workout (SPEC). -->
			<div
				class="border-z4/40 bg-z4/10 mt-4 rounded-lg border px-4 py-3 text-sm"
			>
				<p>
					Your last 90 days suggest an FTP around
					<span class="font-display font-bold">{account.me.suggestedFtp} W</span
					>
					— above your current {account.me.ftpWatts} W.
				</p>
				<div class="mt-2 flex gap-2">
					<button
						onclick={() => {
							ftp = account.me?.suggestedFtp ?? ftp;
							void saveAccount();
							suggestionDismissed = true;
						}}
						class="rounded bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90"
						>Update to {account.me.suggestedFtp} W</button
					>
					<button
						onclick={() => (suggestionDismissed = true)}
						class="border-muted/30 hover:border-muted/60 rounded border px-3 py-1.5 text-xs"
						>Keep {account.me.ftpWatts} W</button
					>
				</div>
			</div>
		{/if}
	{:else}
		<p class="text-muted mt-2 text-xs">
			Stored on this device. Nothing here leaves your browser.
		</p>
	{/if}

	<div
		class="border-muted/15 bg-surface-raised mt-6 grid gap-5 rounded-lg border p-6"
	>
		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>FTP (watts)</span
			>
			<input
				type="number"
				bind:value={ftp}
				min={PROFILE_LIMITS.minFtp}
				max={PROFILE_LIMITS.maxFtp}
				class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
			/>
			<span class="text-muted mt-1 block text-[11px]">
				Every workout's targets scale to this.
				{#if measured}
					Measured by a ramp test on {new Date(measured).toLocaleDateString()}.
				{:else}
					<a href="/ramp" class="underline hover:text-white">Take a ramp test</a
					> to measure it.
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
			<span class="text-muted mt-1 block text-[11px]">
				Only used for w/kg — the number every contest here is scored on.
			</span>
		</label>

		<!-- Sprint setup (#30/#41). 95% rule: two values, one checkbox — the
		     single-speed case genuinely changes the mechanism, not just a taste. -->
		<div class="border-muted/15 grid gap-3 border-t pt-4">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>sprint moments</span
			>
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
				<span class="text-muted mt-1 block text-[11px]">
					The slope a sprint throws you onto. Steeper = heavier gear feel.
				</span>
			</label>
			<label class="text-muted flex items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={singleSpeed} />
				Single-speed setup (Zwift Cog) — sprints use a high ERG target instead of
				slope
			</label>
		</div>

		<div class="flex items-center gap-3">
			<button
				onclick={save}
				class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
				>Save</button
			>
			{#if status}<span class="text-muted text-xs">{status}</span>{/if}
		</div>
	</div>

	{#if account.loaded && !account.me && account.providers.length > 0}
		<div
			class="border-muted/15 bg-surface-raised mt-4 grid gap-2 rounded-lg border p-6"
		>
			<p class="text-muted text-xs">
				Sign in to keep your profile and rides across devices. No passwords —
				ever.
			</p>
			{#each account.providers as id (id)}
				<a
					href="/api/auth/{id}/start"
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-center text-sm"
					>{providerLabels[id] ?? id}</a
				>
			{/each}
		</div>
	{/if}
	{#if account.me}
		<button
			onclick={() => account.signOut()}
			class="text-muted mt-4 text-xs underline hover:text-white"
			>Sign out</button
		>
	{/if}
</main>
