<script lang="ts">
	// The ways back into this account, and the offer to add one (#719).
	// Connecting is a top-level navigation, not a fetch: it leaves for the
	// provider and comes back to /profile?link=<outcome>.
	import { page } from '$app/state';
	import { GITHUB_MARK, GOOGLE_G } from '$lib/brand/icons';
	import Banner from '$lib/components/Banner.svelte';
	import { account } from '$lib/account.svelte';

	let { onUploadToggle }: { onUploadToggle: (on: boolean) => void } = $props();

	const providerName: Record<string, string> = {
		google: 'Google',
		github: 'GitHub',
		strava: 'Strava',
		dev: 'Dev sign-in',
	};

	// Capability gating: only providers this server actually has credentials
	// for, so we never offer a button that 500s (.claude/rules/ux.md).
	const linked = $derived(new Set(account.me?.providers ?? []));
	const connectable = $derived(
		account.providers.filter((id) => !linked.has(id)),
	);

	const outcome = $derived(page.url.searchParams.get('link'));
	const outcomeProvider = $derived(
		providerName[page.url.searchParams.get('provider') ?? ''] ??
			'That provider',
	);

	function connect(id: string) {
		window.location.href = `/api/auth/${id}/start?link=1`;
	}
</script>

<div>
	<span class="eyebrow">connections</span>

	{#if outcome === 'connected'}
		<div class="mt-2">
			<Banner tone="ok">{outcomeProvider} is connected to this account.</Banner>
		</div>
	{:else if outcome === 'taken'}
		<div class="mt-2">
			<Banner>
				That {outcomeProvider} account already signs in to a different WattRoom account,
				so it was left where it is. Sign in with it directly, or connect a different
				one.
			</Banner>
		</div>
	{:else if outcome === 'duplicate'}
		<div class="mt-2">
			<Banner>
				This account already connects to {outcomeProvider}, and one per provider
				is the limit — a second would leave uploads pointing at whichever the
				server picked.
			</Banner>
		</div>
	{:else if outcome === 'failed'}
		<div class="mt-2">
			<Banner>Connecting {outcomeProvider} did not work. Try again.</Banner>
		</div>
	{/if}

	<p class="mt-2 text-sm">
		{[...linked].map((p) => providerName[p] ?? p).join(', ') || '—'}
	</p>

	{#if connectable.length > 0}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#each connectable as id (id)}
				{#if id === 'strava'}
					<!-- Strava's brand guidelines: their asset, unaltered, at its own
					     size, on every OAuth entry point — same rule as login (#549). -->
					<button onclick={() => connect(id)} class="block">
						<img
							src="/strava-connect.svg"
							alt="Connect with Strava"
							width="237"
							height="48"
						/>
					</button>
				{:else}
					<button
						onclick={() => connect(id)}
						class="border-muted/25 bg-surface/60 hover:border-neon/60 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"
					>
						{#if id === 'google'}
							<svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0">
								{#each GOOGLE_G as seg (seg.fill)}
									<path d={seg.d} fill={seg.fill} />
								{/each}
							</svg>
						{:else if id === 'github'}
							<svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 fill-current"
								><path d={GITHUB_MARK} /></svg
							>
						{/if}
						Connect {providerName[id] ?? id}
					</button>
				{/if}
			{/each}
		</div>
		<p class="text-muted mt-2 text-[11px]">
			Another way to sign in to this same account — your rides stay where they
			are.
		</p>
	{/if}

	{#if linked.has('strava')}
		<label class="mt-3 flex items-start gap-2">
			<input
				type="checkbox"
				checked={account.me?.stravaUpload ?? true}
				onchange={(e) => onUploadToggle(e.currentTarget.checked)}
				class="mt-0.5"
			/>
			<span class="text-xs">
				Auto-upload rides to Strava
				<span class="text-muted block text-[11px]">
					Your rides, your Strava, as Virtual Rides. Upload only — nothing is
					ever pulled back.
				</span>
			</span>
		</label>
	{:else if account.providers.includes('strava')}
		<!-- Rides are recorded and .fit-exportable either way; Strava only adds
		     the automatic push, so the copy offers that and nothing more. -->
		<p class="text-muted mt-2 text-[11px]">
			Your rides are saved here and export as .fit whichever account you use.
			Connect Strava and finished rides also upload themselves to your Strava.
		</p>
	{/if}
</div>
