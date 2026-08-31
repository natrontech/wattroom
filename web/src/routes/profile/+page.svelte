<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { AVATAR_PRESETS } from '$lib/avatars';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import { hrZoneRanges, ZONE_TEXT } from '$lib/components/zones';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import { fetchProgression, type TrendRide } from '$lib/progression';

	const profile = createProfileStore();
	void account.load();

	// The FTP number's story (#222) — decorative context under the field, so
	// on failure it simply doesn't render.
	let trend = $state<TrendRide[]>([]);
	void fetchProgression().then((r) => {
		if (r.ok) trend = r.data?.rides ?? [];
	});

	// Coach access tokens (ADR-0017). The secret exists client-side only in
	// freshToken, until the rider hides it.
	interface ApiToken {
		id: string;
		name: string;
		createdAt: string;
		lastUsedAt?: string;
	}
	let apiTokens = $state<ApiToken[]>([]);
	let tokenName = $state('');
	let freshToken = $state<string | null>(null);
	let tokenError = $state<string | null>(null);
	async function loadTokens() {
		const res = await api<{ tokens: ApiToken[] }>('/api/tokens');
		if (res.ok) apiTokens = res.data?.tokens ?? [];
	}
	void loadTokens();
	async function createToken() {
		const res = await api<ApiToken & { token: string }>('/api/tokens', {
			method: 'POST',
			json: { name: tokenName.trim() },
		});
		if (!res.ok) {
			tokenError = res.error.message;
			return;
		}
		tokenError = null;
		tokenName = '';
		freshToken = res.data.token;
		await loadTokens();
	}
	async function revokeToken(id: string) {
		const res = await api<undefined>(`/api/tokens/${id}`, {
			method: 'DELETE',
		});
		if (!res.ok) {
			tokenError = res.error.message;
			return;
		}
		tokenError = null;
		apiTokens = apiTokens.filter((entry) => entry.id !== id);
	}

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
	// null = no anchor set; saving null clears it (ADR-0014, device-local).
	let lthr = $state<number | null>(profile.current.lthr ?? null);
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

		<!-- Coach access (ADR-0017): read-only tokens for your own AI/tools. -->
		<section class="border-muted/15 mt-3 rounded-lg border p-6">
			<h2 class="font-display font-bold">Coach access</h2>
			<p class="text-muted mt-1 text-xs">
				Read-only tokens for your own tools — a personal coach AI can read your
				progression and rides over the API or MCP (<code
					class="font-mono text-[11px]">{location.origin}/mcp</code
				>). Your data only, never anyone else's.
			</p>
			{#if freshToken}
				<div class="border-muted/30 mt-4 rounded-lg border border-dashed p-4">
					<p class="text-xs font-semibold">
						Copy it now — it is never shown again.
					</p>
					<code class="mt-2 block font-mono text-xs break-all select-all"
						>{freshToken}</code
					>
					<p class="text-muted mt-3 text-[11px]">Hook it up to Claude Code:</p>
					<code class="mt-1 block font-mono text-[11px] break-all select-all"
						>claude mcp add --transport http wattroom {location.origin}/mcp
						--header "Authorization: Bearer {freshToken}"</code
					>
					<button
						onclick={() => (freshToken = null)}
						class="text-muted hover:text-ink mt-3 text-xs underline"
						>Done, hide it</button
					>
				</div>
			{/if}
			{#if apiTokens.length > 0}
				<ul class="mt-4 grid gap-2">
					{#each apiTokens as entry (entry.id)}
						<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
							<span class="text-ink font-semibold">{entry.name}</span>
							<span class="text-muted">
								created {new Date(entry.createdAt).toLocaleDateString()}
								{entry.lastUsedAt
									? `· last used ${new Date(entry.lastUsedAt).toLocaleDateString()}`
									: '· never used'}
							</span>
							<button
								onclick={() => void revokeToken(entry.id)}
								class="text-muted hover:text-ink ml-auto underline"
								>Revoke</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<form
				class="mt-4 flex flex-wrap gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void createToken();
				}}
			>
				<input
					bind:value={tokenName}
					maxlength="60"
					placeholder="Token name — e.g. claude coach"
					class="input w-64"
				/>
				<button class="btn btn-secondary" disabled={!tokenName.trim()}
					>Create token</button
				>
			</form>
			{#if tokenError}
				<p class="text-muted mt-2 text-xs">{tokenError}</p>
			{/if}
		</section>

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
