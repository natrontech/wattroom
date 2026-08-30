<script lang="ts">
	import { renderSVG } from 'uqr';

	// The Jam link-out card (#96, ADR-0003): a QR and a link, never an
	// integration. Audio plays in each rider's own Spotify app.
	let {
		jamUrl,
		onSet,
		onClear,
	}: {
		jamUrl: string | undefined;
		/** Absent on read-only surfaces (the phone spectator). */
		onSet?: (url: string) => void;
		onClear?: () => void;
	} = $props();

	let draft = $state('');
	let setError = $state<string | null>(null);

	// Same rule the server enforces — validated here too so the rider gets
	// the reason instead of a silently ignored command.
	function valid(raw: string): boolean {
		try {
			const u = new URL(raw);
			return (
				u.protocol === 'https:' &&
				(u.hostname === 'spotify.link' ||
					u.hostname === 'open.spotify.com' ||
					u.hostname.endsWith('.spotify.com'))
			);
		} catch {
			return false;
		}
	}

	function set() {
		const raw = draft.trim();
		if (!valid(raw)) {
			setError = 'That is not a Spotify link — copy the Jam invite link.';
			return;
		}
		setError = null;
		draft = '';
		onSet?.(raw);
	}

	const qr = $derived(jamUrl ? renderSVG(jamUrl, { border: 1 }) : '');
</script>

{#if jamUrl}
	<div class="border-muted/15 bg-surface-raised rounded-lg border p-3">
		<h3 class="text-muted text-[10px] tracking-[0.2em] uppercase">
			join the jam
		</h3>
		<div class="mt-2 flex items-start gap-3">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr output, generated from a validated URL -->
			<div
				class="h-20 w-20 shrink-0 rounded bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
			>
				{@html qr}
			</div>
			<div class="min-w-0">
				<a
					href={jamUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="block truncate text-xs underline hover:text-white">{jamUrl}</a
				>
				<p class="text-muted mt-1.5 text-[11px] leading-relaxed">
					Jam audio plays outside the browser, so WattRoom can't duck it under
					voice — manage your own volume. The YouTube jukebox is the one that
					ducks.
				</p>
				{#if onClear}
					<button
						onclick={onClear}
						class="text-muted mt-1.5 text-[11px] underline hover:text-white"
						>Clear the Jam</button
					>
				{/if}
			</div>
		</div>
	</div>
{:else if onSet}
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			set();
		}}
	>
		<input
			bind:value={draft}
			placeholder="Paste a Spotify Jam link"
			class="border-muted/25 focus:border-muted/60 min-w-0 flex-1 rounded border bg-transparent px-3 py-1.5 text-xs outline-none"
		/>
		<button
			disabled={!draft.trim()}
			class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
			>Jam</button
		>
	</form>
	{#if setError}<p class="text-z6 mt-1 text-xs">{setError}</p>{/if}
{/if}
