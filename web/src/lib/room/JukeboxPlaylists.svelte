<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JukeboxPlaylistRow from '$lib/room/JukeboxPlaylistRow.svelte';
	import { useRoom } from '$lib/room/context';
	import {
		createPlaylistStore,
		getAutoplay,
		updateAutoplay,
		type AutoplaySettings,
	} from '$lib/room/playlists.svelte';

	// The saved playlists above the live queue (#627): room playlists (any
	// member edits, one markable active) and personal playlists (a rider's
	// own, queueable into whichever room they're in). Autoplay itself is a
	// room setting and lives on the room's Settings page (#1422); this panel
	// says what it is set to and keeps the one-tap "Set as active" on a row.
	let { slug }: { slug: string } = $props();

	// Rename, delete, set active and remove a track are the coach's and the
	// owner's (SPEC roles matrix, #771); a member's own personal playlists
	// stay theirs. Gated here so nothing renders that the server would refuse
	// on click (#824).
	const room = useRoom();
	const canManage = $derived(room.canControl);

	let tab = $state<'room' | 'mine'>('room');
	const roomStore = $derived.by(() =>
		createPlaylistStore(`/api/rooms/${slug}/playlists`),
	);
	const mineStore = createPlaylistStore('/api/playlists');
	const store = $derived(tab === 'room' ? roomStore : mineStore);

	let newName = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function create() {
		const name = newName.trim();
		if (!name) return;
		creating = true;
		createError = null;
		const res = await store.create(name);
		creating = false;
		if (!res.ok) {
			createError = res.error.message;
			return;
		}
		newName = '';
	}

	// Read for the status line and for "Set as active", which PATCHes the
	// whole setting the way the Settings page does.
	let autoplay = $state<AutoplaySettings | null>(null);
	$effect(() => {
		if (slug) void loadAutoplay();
	});
	async function loadAutoplay() {
		const res = await getAutoplay(slug);
		autoplay = res.ok ? (res.data ?? null) : null;
	}
	async function setActive(id: string) {
		if (!autoplay) return;
		const next = { ...autoplay, activePlaylistId: id };
		const res = await updateAutoplay(slug, next);
		if (!res.ok) {
			createError = res.error.message;
			return;
		}
		autoplay = res.data ?? next;
		await roomStore.refresh();
	}

	const activeName = $derived(roomStore.all.find((p) => p.active)?.name);
	const status = $derived.by(() => {
		if (!autoplay) return null;
		if (!autoplay.enabled) return 'Autoplay off';
		if (autoplay.order === 'smart') return 'Autoplay · smart, from the library';
		return `Autoplay · ${activeName ?? 'no active playlist'} · ${autoplay.order}`;
	});
</script>

<details class="min-w-0">
	<summary class="eyebrow cursor-pointer select-none">playlists</summary>

	<div class="mt-2 flex gap-1.5" role="tablist">
		<button
			role="tab"
			aria-selected={tab === 'room'}
			onclick={() => (tab = 'room')}
			class="btn btn-xs {tab === 'room' ? 'btn-secondary' : 'text-muted'}"
			>Room</button
		>
		<button
			role="tab"
			aria-selected={tab === 'mine'}
			onclick={() => (tab = 'mine')}
			class="btn btn-xs {tab === 'mine' ? 'btn-secondary' : 'text-muted'}"
			>Mine</button
		>
	</div>

	{#if tab === 'room' && status}
		<!-- One line, not the controls: autoplay is set on the Settings page
		     (#1422). The link is only drawn for who may follow it to a form. -->
		<p class="text-muted mt-2 text-[10px]">
			{status}{#if canManage}
				· <a href="/r/{slug}/settings" class="underline">settings</a>{/if}
		</p>
	{/if}

	<div class="mt-2 min-w-0">
		{#if !store.loaded}
			<Skeleton class="h-9" rows={2} />
		{:else if store.error}
			<p class="text-danger text-[11px] leading-relaxed">
				{store.error}
				<button onclick={() => store.refresh()} class="ml-1 underline"
					>Retry</button
				>
			</p>
		{:else if store.all.length === 0}
			<p class="text-muted text-[11px] leading-relaxed">
				{tab === 'room'
					? 'No room playlists yet — the first one below is a click away.'
					: "No personal playlists yet — yours to build, queueable in any room you're in."}
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each store.all as playlist (playlist.id)}
					<JukeboxPlaylistRow
						{playlist}
						{store}
						{slug}
						roomScoped={tab === 'room'}
						canManage={tab !== 'room' || canManage}
						onSetActive={tab === 'room'
							? () => void setActive(playlist.id)
							: undefined}
					/>
				{/each}
			</ul>
		{/if}

		<form
			class="mt-2 flex min-w-0 gap-1.5"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<input
				bind:value={newName}
				placeholder={tab === 'room'
					? 'New room playlist…'
					: 'New personal playlist…'}
				class="input input-xs min-w-0 flex-1"
				aria-label="new playlist name"
			/>
			<button
				disabled={!newName.trim() || creating}
				class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
				aria-label="create playlist"><Plus size={14} /></button
			>
		</form>
		{#if createError}<p class="text-danger mt-1 text-[11px]">
				{createError}
			</p>{/if}
	</div>
</details>
