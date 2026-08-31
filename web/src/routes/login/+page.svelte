<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { GITHUB_MARK, GOOGLE_G, STRAVA_MARK } from '$lib/brand/icons';
	import { account } from '$lib/account.svelte';
	import { rememberNext, takeNext } from '$lib/auth/next';

	void account.load();

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

	// Already signed in (or just returned from OAuth): straight through.
	$effect(() => {
		if (account.loaded && account.me) {
			void goto(takeNext() ?? '/rooms', { replaceState: true });
		}
	});

	function start(id: string) {
		rememberNext(page.url.searchParams.get('next'));
		window.location.href = `/api/auth/${id}/start`;
	}
</script>

<main
	class="cave bg-surface text-ink relative grid min-h-dvh place-items-center px-6"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<div class="relative w-full max-w-md">
		<div
			class="border-muted/20 bg-surface-raised/80 rounded-xl border px-8 py-10 text-center backdrop-blur"
		>
			<a href="/" class="inline-block" aria-label="WattRoom home">
				<Logo size={52} wordmark />
			</a>
			<p class="text-muted mt-3 text-sm">Train together, not alone.</p>

			{#if !account.loaded}
				<p class="text-muted mt-8 text-sm">Loading…</p>
			{:else if account.providers.length > 0}
				<div class="mt-8 grid gap-2.5">
					{#each account.providers as id (id)}
						<button
							onclick={() => start(id)}
							class="border-muted/25 bg-surface/60 hover:border-neon/60 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium"
						>
							{#if id === 'google'}
								<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0">
									{#each GOOGLE_G as seg (seg.fill)}
										<path d={seg.d} fill={seg.fill} />
									{/each}
								</svg>
							{:else if id === 'github'}
								<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 fill-current"
									><path d={GITHUB_MARK} /></svg
								>
							{:else if id === 'strava'}
								<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="#FC4C02"
									><path d={STRAVA_MARK} /></svg
								>
							{:else}
								<span
									class="font-display text-neon w-5 shrink-0 text-center text-xs font-bold"
									>&gt;_</span
								>
							{/if}
							<span class="min-w-0">
								{providerLabels[id]?.label ?? id}
								{#if providerLabels[id]?.note}
									<span class="text-muted block text-[11px] font-normal"
										>{providerLabels[id].note}</span
									>
								{/if}
							</span>
						</button>
					{/each}
				</div>
				<p class="text-muted mt-6 text-[11px]">
					No passwords — use an account you already have.
				</p>
			{:else}
				<!-- Capability gating: no providers, no dead buttons — say why. -->
				<p class="text-muted mx-auto mt-8 max-w-sm text-xs leading-relaxed">
					No sign-in providers are configured on this server, so nobody can sign
					in. The operator needs to set the WATTROOM_OAUTH_* environment
					variables (or WATTROOM_DEV_LOGIN=1 in development).
				</p>
			{/if}
		</div>

		<p class="text-muted mt-5 text-center text-[11px]">
			free &amp; open source ·
			<a
				href="https://github.com/natrontech/wattroom"
				class="hover:text-ink underline">star on GitHub</a
			>
			· by
			<a href="https://natron.io" class="hover:text-ink underline">Natron</a>
		</p>
	</div>
</main>
