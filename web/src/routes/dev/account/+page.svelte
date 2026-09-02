<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';

	let signedIn = $state(true);
	let confirmDelete = $state(false);
	let deleteConfirmation = $state('');

	// WATTROOM.md: social OAuth only — Google, GitHub, Strava. No passwords, ever.
	const providers = [
		{ id: 'google', label: 'Continue with Google' },
		{ id: 'github', label: 'Continue with GitHub' },
		{
			id: 'strava',
			label: 'Continue with Strava',
			note: 'also connects ride upload',
		},
	];

	let profile = $state({ name: 'Jan', ftp: 265, kg: 74 });
</script>

<main class="mx-auto max-w-2xl px-6 py-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-3xl font-bold tracking-tight">
			{signedIn ? 'Profile' : 'Sign in'}
		</h1>
		<label class="text-muted flex items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={signedIn} /> signed in
		</label>
	</div>

	{#if !signedIn}
		<div
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8 text-center"
		>
			<Logo size={48} />
			<p class="mt-5 text-sm">Train together, not alone.</p>
			<p class="text-muted mx-auto mt-2 max-w-sm text-xs leading-relaxed">
				No passwords — WattRoom uses accounts you already have. Strava also
				connects ride upload, so you can skip that step later.
			</p>
			<div class="mx-auto mt-7 grid max-w-xs gap-2">
				{#each providers as provider (provider.id)}
					<button
						class="border-muted/25 hover:border-muted/60 w-full rounded border px-4 py-3 text-sm"
					>
						{provider.label}
						{#if provider.note}
							<span class="text-muted block text-[11px]">{provider.note}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<section
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-6"
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>display name</span
					>
					<input
						bind:value={profile.name}
						class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 text-sm"
					/>
				</label>
				<div>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>signed in with</span
					>
					<p class="mt-2 text-sm">GitHub · jan.lauber</p>
				</div>
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>FTP (W)</span
					>
					<input
						type="number"
						bind:value={profile.ftp}
						class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>Sets every workout's targets. A ramp test measures it for you.</span
					>
				</label>
				<label class="block">
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>weight (kg)</span
					>
					<input
						type="number"
						bind:value={profile.kg}
						class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums"
					/>
					<span class="text-muted mt-1 block text-[11px]"
						>Only used for w/kg — the number every contest here is scored on.</span
					>
				</label>
			</div>
		</section>

		<div class="mt-3">
			<FtpPrompt current={profile.ftp} suggested={278} best20={293} />
		</div>

		<!-- WATTROOM.md: privacy is architecture. Say what is true, not what sounds good. -->
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
				<button
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
					>Export everything</button
				>
				<button
					onclick={() => (confirmDelete = true)}
					class="border-danger/40 text-danger hover:bg-danger/10 rounded border px-4 py-2 text-sm"
					>Delete account</button
				>
			</div>

			{#if confirmDelete}
				<!--
					Confirmation dialogs are for the genuinely destructive only
					(.claude/rules/errors.md) — everything else gets undo. This qualifies.
				-->
				<div class="border-danger/50 bg-danger/10 mt-4 rounded-lg border p-5">
					<p class="text-sm font-medium">
						This deletes everything, permanently.
					</p>
					<p class="text-muted mt-1.5 text-xs leading-relaxed">
						Every ride, your power curve, your XP and level, and the rooms you
						own. Rooms you own are deleted for everyone in them. There is no
						undo and no backup we can restore from — that's the point of a full
						purge.
					</p>
					<label class="mt-4 block">
						<span class="text-muted text-[11px]">Type DELETE to confirm</span>
						<input
							bind:value={deleteConfirmation}
							class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm"
						/>
					</label>
					<div class="mt-3 flex gap-2">
						<button
							disabled={deleteConfirmation !== 'DELETE'}
							class="btn btn-danger-solid">Delete my account</button
						>
						<button
							onclick={() => (
								(confirmDelete = false),
								(deleteConfirmation = '')
							)}
							class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
							>Cancel</button
						>
					</div>
				</div>
			{/if}
		</section>
	{/if}
</main>
