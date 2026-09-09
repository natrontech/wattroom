<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import { GITHUB_MARK, GOOGLE_G } from '$lib/brand/icons';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { rememberNext, takeNext } from '$lib/auth/next';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import { crewDoor, type CrewDoor } from '$lib/crew';
	import { lastProvider, rememberProvider } from '$lib/auth/last-provider';
	import Banner from '$lib/components/Banner.svelte';
	import * as passkeys from '$lib/passkeys';
	import {
		browserSignInUrl,
		desktopNonce,
		handoffLink,
		redeemHandoff,
		shellVersion,
		startBrowserSignIn,
	} from '$lib/desktop';

	void account.load();

	// A discoverable passkey needs no identifier: the browser resolves the
	// account and shows the rider which one it is (#782, ADR-0029). Hidden
	// where the browser cannot do it, rather than failing on click.
	const canPasskey = passkeys.supported();
	let passkeyBusy = $state(false);
	let passkeyError = $state('');

	// The desktop shell cannot sign a rider in (#1188, ADR-0040): no WebAuthn
	// UI, and Google refuses OAuth from an Electron window. So inside the
	// shell this page has one button, which opens THIS page in the system
	// browser with a nonce; and in the browser, with that nonce in the query,
	// a finished sign-in is handed back through wattroom://auth/<token>.
	const shell = shellVersion() !== null;
	const nonce = $derived(desktopNonce(page.url.searchParams));
	// After the OAuth round trip the app lands on "/" and follows the stash;
	// with a nonce, the stash is this page again so the handoff can happen.
	const nextAfterSignIn = () =>
		nonce ? `/login?desktop=${nonce}` : page.url.searchParams.get('next');

	// A rider who arrived by a crew's invite link (#1236) meets this gate
	// first, and the gate should say what is on the other side: the door is
	// public, so it is one read away. Anything else in `next` stays a path.
	const inviteCode = $derived(
		/^\/c\/([A-Za-z0-9]{6})$/.exec(
			page.url.searchParams.get('next') ?? '',
		)?.[1] ?? null,
	);
	let invite = $state<CrewDoor | null>(null);
	$effect(() => {
		const code = inviteCode;
		invite = null;
		if (!code) return;
		void crewDoor(code).then((res) => {
			if (res.ok && inviteCode === code) invite = res.data;
		});
	});

	let browserOpened = $state(false);
	let handoffError = $state('');
	let redeeming = $state(false);
	/** The link back to the app, once minted — shown, and followed. */
	let backToApp = $state<string | null>(null);

	function openBrowser() {
		browserOpened = true;
		handoffError = '';
		// Off-origin, so the shell hands it to the system browser.
		window.open(
			browserSignInUrl(location.origin, startBrowserSignIn()),
			'_blank',
		);
	}

	// Arriving in the shell from wattroom://auth/<token>: redeem it once.
	let redeemed = false;
	$effect(() => {
		const token = page.url.searchParams.get('handoff');
		if (!shell || !token || redeemed) return;
		redeemed = true;
		redeeming = true;
		void redeemHandoff(token).then(async (err) => {
			redeeming = false;
			if (err) {
				handoffError = err;
				return;
			}
			await account.load();
		});
	});

	async function withPasskey() {
		// The same deep link the provider buttons keep (#824): a rider bounced
		// off /r/tuesday lands back in the room, not on /home.
		rememberNext(nextAfterSignIn());
		passkeyBusy = true;
		passkeyError = '';
		const result = await passkeys.signIn();
		passkeyBusy = false;
		if ('error' in result) {
			passkeyError = result.error;
			return;
		}
		// The session cookie is set; let the store pick the account up and the
		// effect below route on from there.
		await account.load();
	}

	// ADR-0029: still no passwords. A passkey is not one.
	const providerLabels: Record<string, { label: string; note?: string }> = {
		google: { label: 'Continue with Google' },
		github: { label: 'Continue with GitHub' },
		strava: {
			label: 'Connect with Strava',
			note: 'also connects ride upload',
		},
		dev: { label: 'Dev sign-in (local only)' },
	};

	// Already signed in (or just returned from OAuth): straight through — or,
	// when this browser was opened by the desktop shell, back to it.
	let handedOff = false;
	$effect(() => {
		if (!account.loaded || !account.me) return;
		if (nonce && !shell) {
			if (handedOff) return;
			handedOff = true;
			takeNext();
			void handoffLink(nonce).then((link) => {
				if (!link) {
					handoffError =
						'Could not hand this sign-in to the app. Open WattRoom on your desk and try again.';
					return;
				}
				backToApp = link;
				location.href = link;
			});
			return;
		}
		void goto(takeNext() ?? '/home', { replaceState: true });
	});

	// Which button this browser used last (#784) — the cheapest answer to
	// "which one did I use?", and the one that stops a second empty account.
	const previous = lastProvider();

	function start(id: string) {
		rememberNext(nextAfterSignIn());
		rememberProvider(id);
		window.location.href = `/api/auth/${id}/start`;
	}
</script>

<svelte:head><title>Sign in · WattRoom</title></svelte:head>

<main
	class="cave bg-surface text-ink relative grid min-h-dvh place-items-center px-6"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<!-- In the desktop shell this is the first screen, on a window built for a
	     desk (#1188): the pitch and the live-room scene on the left, the one
	     sign-in on the right. In a browser the card stands alone as before. -->
	<div
		class="relative w-full {shell
			? 'max-w-5xl lg:grid lg:grid-cols-[1.15fr_minmax(20rem,1fr)] lg:items-center lg:gap-14'
			: 'max-w-md'}"
	>
		{#if shell}
			<div class="hidden lg:block">
				<Logo size={40} wordmark />
				<h1 class="font-display mt-8 text-4xl leading-tight font-bold">
					Train together, not alone.
				</h1>
				<p class="text-muted mt-3 max-w-md text-base leading-relaxed">
					A room, a coach, and everyone's watts on one screen. Your trainer does
					the rest.
				</p>
				<div class="mt-8 w-full max-w-xl"><LandingHero /></div>
			</div>
		{/if}
		<div
			class="border-muted/20 bg-surface-raised/80 rounded-xl border px-8 py-10 text-center backdrop-blur"
		>
			<a
				href="/"
				class="inline-block {shell ? 'lg:hidden' : ''}"
				aria-label="WattRoom home"
			>
				<Logo size={52} wordmark />
			</a>
			<p class="text-muted mt-3 text-sm {shell ? 'lg:hidden' : ''}">
				Train together, not alone.
			</p>
			{#if invite}
				<!-- The invite is the reason they are here: name the crew before
				     asking for anything. Sign-in lands them on its door (#1236). -->
				<div
					class="border-muted/20 mt-6 flex items-center gap-3 rounded-lg border px-4 py-3 text-left"
				>
					<CrewMark
						name={invite.name}
						icon={invite.icon}
						imageUrl={invite.imageUrl}
						size={36}
						class="rounded-lg"
					/>
					<p class="min-w-0 text-sm">
						You are invited to <span class="font-display font-bold"
							>{invite.name}</span
						>
						<span class="text-muted"
							>· {invite.members === 1
								? '1 rider'
								: `${invite.members} riders`}</span
						>
						<span class="text-muted block text-xs">Sign in to join.</span>
					</p>
				</div>
			{/if}
			{#if shell}
				<div class="hidden text-left lg:block">
					<p class="eyebrow">the desktop app</p>
					<h2 class="font-display mt-1 text-2xl font-bold">Sign in</h2>
				</div>
			{/if}

			{#if !account.loaded}
				<Skeleton class="mt-8 h-11" rows={2} />
			{:else if backToApp}
				<!-- The browser half is done (#1188): the link opens the app. -->
				<p class="mt-8 text-sm">You are signed in. Back to the WattRoom app.</p>
				<a href={backToApp} class="btn btn-primary btn-lg mt-4 w-full"
					>Open WattRoom</a
				>
				<p class="text-muted mt-3 text-xs">
					If nothing happened, the app is not installed on this computer — get
					it at
					<a href="/download" class="hover:text-ink underline"
						>wattroom.ch/download</a
					>.
				</p>
			{:else if shell}
				<!-- Inside the desktop shell: one button, the browser does the rest. -->
				<div class="mt-8">
					{#if handoffError}
						<div class="mb-3 text-left"><Banner>{handoffError}</Banner></div>
					{/if}
					{#if redeeming}
						<p class="text-sm" aria-busy="true">Signing you in…</p>
					{:else}
						<button onclick={openBrowser} class="btn btn-primary btn-lg w-full">
							Sign in with your browser
						</button>
						<p class="text-muted mt-2 text-xs leading-relaxed">
							Your passkey, GitHub or Strava — in the browser you already use.
							Come back here once it says you are signed in.
						</p>
						{#if browserOpened}
							<p class="text-muted mt-5 text-xs" aria-live="polite">
								Waiting for your browser…
								<button onclick={openBrowser} class="btn-link"
									>open it again</button
								>
							</p>
						{/if}
					{/if}
				</div>
			{:else}
				{#if handoffError && nonce}
					<div class="mt-6 text-left"><Banner>{handoffError}</Banner></div>
				{/if}
				{#if nonce}
					<p class="text-muted mt-6 text-xs">
						Signing in for the WattRoom desktop app — you will be sent back to
						it.
					</p>
				{/if}
				{#if canPasskey}
					<div class="mt-8">
						<button
							onclick={withPasskey}
							disabled={passkeyBusy}
							class="border-neon/40 bg-surface/60 hover:border-neon flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
						>
							{passkeyBusy
								? 'Waiting for your passkey…'
								: 'Sign in with a passkey'}
						</button>
						<p class="text-muted mt-1.5 text-[11px]">
							Your phone, your password manager, or a security key.
						</p>
						{#if passkeyError}
							<div class="mt-3 text-left"><Banner>{passkeyError}</Banner></div>
						{/if}
					</div>
				{/if}
			{/if}

			{#if account.loaded && account.providers.length > 0 && !shell && !backToApp}
				<div class="mt-4 grid gap-2.5">
					{#each account.providers as id (id)}
						{#if id === 'strava'}
							<!-- Strava's brand guidelines: their asset, unaltered, at its own size. -->
							<button onclick={() => start(id)} class="justify-self-center">
								<img
									src="/strava-connect.svg"
									alt={providerLabels[id]?.label ?? id}
									width="237"
									height="48"
								/>
								<span class="text-muted mt-1 block text-[11px]">
									{previous === id
										? 'you used this last time'
										: providerLabels[id]?.note}
								</span>
							</button>
						{:else}
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
								{:else}
									<span
										class="font-display text-neon w-5 shrink-0 text-center text-xs font-bold"
										>&gt;_</span
									>
								{/if}
								<span class="min-w-0">
									{providerLabels[id]?.label ?? id}
									{#if previous === id}
										<span class="text-muted block text-[11px] font-normal"
											>you used this last time</span
										>
									{:else if providerLabels[id]?.note}
										<span class="text-muted block text-[11px] font-normal"
											>{providerLabels[id].note}</span
										>
									{/if}
								</span>
							</button>
						{/if}
					{/each}
				</div>
				<p class="text-muted mt-6 text-[11px]">
					No passwords — use an account you already have.
					{#if account.mailAvailable}
						<!-- The gate (ADR-0029) is the first screen after sign-in for a
						     new account; say so here rather than let it be a surprise
						     (audit 2026-09-09). -->
						<span class="block">
							New accounts confirm an email address — it is only used to get you
							back in.
						</span>
					{/if}
				</p>
			{:else if account.loaded && account.unreachable}
				<!-- Not "unconfigured": the question never reached the server. -->
				<div class="mx-auto mt-8 max-w-sm text-left">
					<Banner tone="error">
						The server could not be reached — check your connection and try
						again.
						{#snippet action()}
							<button
								onclick={() => void account.load()}
								class="btn-link text-xs">Retry</button
							>
						{/snippet}
					</Banner>
				</div>
			{:else if account.loaded}
				<!-- Capability gating: no providers, no dead buttons — say why. A
				     passkey is only ever added from an account that already exists,
				     so without a provider nobody can make a first one. -->
				<p class="text-muted mx-auto mt-8 max-w-sm text-xs leading-relaxed">
					No sign-in providers are configured on this server, so no new account
					can be made here{canPasskey
						? ' — only an existing passkey works'
						: ''}. The operator needs to set the WATTROOM_OAUTH_* environment
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
			·
			<a href="/legal" class="hover:text-ink underline">legal</a>
			·
			<a href="/privacy" class="hover:text-ink underline">privacy</a>
		</p>
	</div>
</main>
