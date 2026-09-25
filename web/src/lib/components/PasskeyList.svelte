<script lang="ts">
	// The passkeys on this account (#782, ADR-0029) — a credential in the same
	// set as the sign-in providers beside it, which is why the last one can
	// never be removed.
	//
	// Rename and remove sit on the row as buttons rather than behind a context
	// menu: this is a settings surface, not something reached mid-ride, and
	// .claude/rules/ux.md asks that nothing live only in a menu.
	import Banner from './Banner.svelte';
	import Skeleton from './Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import * as passkeys from '$lib/passkeys';
	import { shellVersion } from '$lib/desktop';

	// Two different preconditions, and the rider can act on one of them
	// (#2256). The browser is theirs to change; whether this server derived a
	// relying party from WATTROOM_BASE_URL is the operator's, and a server
	// that did not leaves every route below unmounted — Add answered 404.
	const browserCan = passkeys.supported();
	const canPasskey = $derived(browserCan && account.passkeysAvailable);
	// The desktop shell's Chromium says it can, and then the prompt never
	// comes (ADR-0040, #2826): adding one happens in the browser. The list,
	// rename and remove are plain requests and stay here.
	const shell = shellVersion() !== null;

	let keys = $state<passkeys.Passkey[]>([]);
	let loaded = $state(false);
	// Why the list could not be read — the fourth state (errors.md, #1827),
	// distinct from `error`, which is a ceremony's own refusal.
	let loadError = $state<string | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');

	async function refresh() {
		const res = await passkeys.list();
		keys = res.keys;
		loadError = res.error;
		loaded = true;
	}
	// A plain `let`, not $state: the guard is not rendered, and a $state
	// written from an effect re-arms the effect (#2163).
	let asked = false;
	$effect(() => {
		if (canPasskey && !asked) {
			asked = true;
			void refresh();
		}
	});

	async function add() {
		busy = true;
		error = '';
		error = (await passkeys.add(name.trim() || 'Passkey')) ?? '';
		busy = false;
		if (!error) {
			name = '';
			await refresh();
		}
	}

	// Renaming happens on the row (#2155). It used to call `prompt()`, which
	// Electron does not implement — "prompt() is and will not be supported" —
	// so in the desktop shell, which loads this same SPA (ADR-0037), Rename
	// did nothing and said nothing. In a browser it was an OS dialog with none
	// of the kit's shape. The add row below is the same input-and-button, so
	// this is the pattern the surface already had.
	let renaming = $state<string | null>(null);
	let draft = $state('');
	function startRename(key: passkeys.Passkey) {
		renaming = key.id;
		draft = key.name;
	}
	async function commitRename(key: passkeys.Passkey) {
		const next = draft.trim();
		renaming = null;
		if (next === '' || next === key.name) return;
		error = (await passkeys.rename(key.id, next)) ?? '';
		await refresh();
	}

	// Asked first: nothing puts a credential back, and the authenticator
	// cannot re-create this one (errors.md, #1493).
	async function remove(key: passkeys.Passkey) {
		if (!(await passkeys.confirmRemoval(key))) return;
		error = (await passkeys.remove(key.id)) ?? '';
		await refresh();
	}

	const when = (iso?: string) =>
		iso ? new Date(iso).toLocaleDateString() : 'never used';
</script>

<div>
	<span class="eyebrow">passkeys</span>

	{#if !browserCan}
		<p class="text-muted mt-2 text-[11px]">
			This browser cannot use passkeys. Open WattRoom in a recent Chrome, Safari
			or Firefox to add one.
		</p>
	{:else if !canPasskey}
		<p class="text-muted mt-2 text-[11px]">
			This server has passkeys turned off — whoever runs it needs to set
			WATTROOM_BASE_URL to the address WattRoom is served from. Your other
			sign-ins still work.
		</p>
	{:else}
		{#if error}
			<div class="mt-2"><Banner>{error}</Banner></div>
		{/if}

		{#if !loaded}
			<div class="mt-2"><Skeleton rows={2} class="h-5" /></div>
		{:else if loadError}
			<div class="mt-2">
				<Banner tone="error">
					{loadError}
					{#snippet action()}
						<button onclick={() => void refresh()} class="btn-link text-xs"
							>Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else if keys.length === 0}
			<p class="text-muted mt-2 text-sm">
				Add one and you can sign in with your phone, your password manager or a
				security key — no provider, nothing to type.
			</p>
		{:else}
			<ul class="mt-2 grid gap-1.5">
				{#each keys as key (key.id)}
					<li class="flex items-center gap-3 text-sm">
						{#if renaming === key.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								bind:value={draft}
								maxlength="40"
								autofocus
								aria-label="rename {key.name}"
								onkeydown={(e) => {
									if (e.key === 'Enter') void commitRename(key);
									if (e.key === 'Escape') renaming = null;
								}}
								class="input input-xs min-w-0 flex-1"
							/>
							<button
								onclick={() => void commitRename(key)}
								class="btn btn-secondary btn-xs">Save</button
							>
							<button
								onclick={() => (renaming = null)}
								class="btn btn-ghost btn-xs">Keep it</button
							>
						{:else}
							<span class="min-w-0 flex-1 truncate">
								{key.name}
								<span class="text-muted block text-[11px]">
									added {when(key.createdAt)} · {key.lastUsedAt
										? `last used ${when(key.lastUsedAt)}`
										: 'never used'}
								</span>
							</span>
							<button
								onclick={() => startRename(key)}
								class="btn btn-ghost btn-xs">Rename</button
							>
							<button onclick={() => remove(key)} class="btn btn-danger btn-xs"
								>Remove</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if shell}
			<p class="text-muted mt-3 text-[11px]">
				Passkeys are added in your browser — the app cannot show the prompt.
				<button
					onclick={() =>
						window.open(`${location.origin}/settings/profile`, '_blank')}
					class="btn-link text-[11px]">Open this page in your browser</button
				>
			</p>
		{:else}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<input
					bind:value={name}
					maxlength="40"
					placeholder="Phone, YubiKey…"
					aria-label="name for the passkey"
					class="input w-40"
				/>
				<button onclick={add} disabled={busy} class="btn btn-secondary btn-xs">
					{busy ? 'Waiting…' : 'Add a passkey'}
				</button>
			</div>
		{/if}
	{/if}
</div>
