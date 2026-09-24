<script lang="ts">
	// The emoji picker (#2643): a reaction, or an emoji into a draft. The
	// rider's own set (#2722) and the crew's uploaded emoji first, then recent
	// picks, then every Unicode emoji by group, and a search across all of it.
	// Fixed to the viewport beside the control that opened it — the chat log
	// clips its overflow — and a sheet along the bottom on a phone.
	import Flag from '@lucide/svelte/icons/flag';
	import Hand from '@lucide/svelte/icons/hand';
	import Hash from '@lucide/svelte/icons/hash';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Pizza from '@lucide/svelte/icons/pizza';
	import Plane from '@lucide/svelte/icons/plane';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Smile from '@lucide/svelte/icons/smile';
	import Volleyball from '@lucide/svelte/icons/volleyball';
	import Search from '@lucide/svelte/icons/search';
	import Star from '@lucide/svelte/icons/star';
	import Banner from '$lib/components/Banner.svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { focusTrap } from '$lib/components/focus-trap';
	import { crewEmoji } from './crew-emoji.svelte';
	import { loadEmoji, searchEmoji, type EmojiGroup } from './data';

	let {
		anchor,
		quick = [],
		crewId,
		onPick,
		onClose,
	}: {
		/** What opened it: the picker sits beside it and ignores clicks on it. */
		anchor: HTMLElement;
		/** The rider's own reaction set (#2722), first in line. */
		quick?: string[];
		/** Whose uploaded emoji to offer; none outside a crew. */
		crewId?: string;
		onPick: (key: string) => void;
		onClose: () => void;
	} = $props();

	// The group tabs are chrome, so they are icons (#458); what they open is
	// the rider's content, and that is emoji.
	const TAB_ICONS = {
		smile: Smile,
		hand: Hand,
		'paw-print': PawPrint,
		pizza: Pizza,
		plane: Plane,
		volleyball: Volleyball,
		lightbulb: Lightbulb,
		hash: Hash,
		flag: Flag,
	} as Record<string, typeof Smile>;

	const RECENT = 'wattroom.emoji.recent.v1';
	const RECENT_MAX = 16;
	const recent = (() => {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
			return Array.isArray(saved)
				? saved.filter((k) => typeof k === 'string')
				: [];
		} catch {
			return [];
		}
	})();

	function pick(key: string) {
		try {
			const next = [key, ...recent.filter((k) => k !== key)].slice(
				0,
				RECENT_MAX,
			);
			localStorage.setItem(RECENT, JSON.stringify(next));
		} catch {
			// A private window forgets; the pick still lands.
		}
		onPick(key);
	}

	let groups = $state<EmojiGroup[]>([]);
	let loadError = $state<string | null>(null);
	function load() {
		loadError = null;
		loadEmoji().then(
			(all) => (groups = all),
			() =>
				(loadError =
					'The emoji did not load. Check the connection and try again.'),
		);
	}
	load();

	let query = $state('');
	// -1 is the first tab: your set, the crew's emoji, your recent ones.
	let tab = $state(-1);
	const custom = $derived(crewId ? crewEmoji.list(crewId) : []);
	const hits = $derived(searchEmoji(groups, query));
	const customHits = $derived(
		query.trim()
			? custom.filter((e) =>
					e.name.includes(query.trim().toLowerCase().replace(/:/g, '')),
				)
			: [],
	);

	// Beside the anchor, below it when there is room, clamped to the viewport.
	const W = 320;
	const H = 360;
	const place = (() => {
		const at = anchor.getBoundingClientRect();
		const below = innerHeight - at.bottom > H + 8 || at.top < H + 8;
		return {
			top: below
				? Math.min(at.bottom + 4, innerHeight - H - 8)
				: at.top - H - 4,
			left: Math.max(8, Math.min(at.right - W, innerWidth - W - 8)),
		};
	})();

	function outside(node: HTMLElement) {
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (node.contains(target) || anchor.contains(target)) return;
			onClose();
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

{#snippet cell(key: string, label: string)}
	<button
		type="button"
		onclick={() => pick(key)}
		title={label}
		aria-label={label}
		class="hover:bg-surface-raised focus-visible:ring-neon grid h-9 w-9 place-items-center rounded focus-visible:ring-2"
		><CheerIcon cheer={key} size={22} /></button
	>
{/snippet}

{#snippet crewCell(name: string, id: string)}
	<button
		type="button"
		onclick={() => pick(`:${name}:`)}
		title=":{name}:"
		aria-label=":{name}:"
		class="hover:bg-surface-raised focus-visible:ring-neon grid h-9 w-9 place-items-center rounded focus-visible:ring-2"
		><img
			src="/api/crews/{crewId}/emoji/{id}"
			alt=""
			width="24"
			height="24"
			class="object-contain"
		/></button
	>
{/snippet}

<div
	{@attach outside}
	use:focusTrap
	role="dialog"
	aria-label="Pick an emoji"
	tabindex="-1"
	style:--top="{place.top}px"
	style:--left="{place.left}px"
	class="panel panel-flush fixed inset-x-0 bottom-0 z-50 flex h-[22.5rem] flex-col shadow-2xl sm:inset-x-auto sm:top-(--top) sm:bottom-auto sm:left-(--left) sm:w-80"
>
	<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-2">
		<Search size={14} class="text-muted shrink-0" />
		<input
			bind:value={query}
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				const first = customHits[0]
					? `:${customHits[0].name}:`
					: hits[0]?.unicode;
				if (first) pick(first);
			}}
			maxlength="40"
			placeholder="Find an emoji"
			aria-label="Find an emoji"
			class="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none"
		/>
	</div>

	{#if !query.trim()}
		<div
			class="border-ink/5 flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1"
			role="tablist"
		>
			<button
				type="button"
				role="tab"
				aria-selected={tab === -1}
				aria-label="Your reactions and recent"
				onclick={() => (tab = -1)}
				class="grid h-8 w-8 shrink-0 place-items-center rounded {tab === -1
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}"><Star size={15} /></button
			>
			{#each groups as group, i (group.label)}
				{@const Icon = TAB_ICONS[group.key]}
				<button
					type="button"
					role="tab"
					aria-selected={tab === i}
					aria-label={group.label}
					title={group.label}
					onclick={() => (tab = i)}
					class="grid h-8 w-8 shrink-0 place-items-center rounded {tab === i
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'}"><Icon size={15} /></button
				>
			{/each}
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if loadError}
			<Banner tone="error">
				{loadError}
				{#snippet action()}
					<button onclick={load} class="btn btn-secondary btn-xs">Retry</button>
				{/snippet}
			</Banner>
		{:else if query.trim()}
			{#if hits.length === 0 && customHits.length === 0}
				<p class="text-muted p-3 text-center text-xs">
					Nothing for “{query.trim()}”. One word usually finds more.
				</p>
			{:else}
				<div class="grid grid-cols-8 gap-0.5">
					{#each customHits as e (e.id)}{@render crewCell(e.name, e.id)}{/each}
					{#each hits as e (e.unicode)}{@render cell(e.unicode, e.label)}{/each}
				</div>
			{/if}
		{:else if tab === -1}
			{#if quick.length}
				<p class="eyebrow px-1 pb-1">Your reactions</p>
				<div class="grid grid-cols-8 gap-0.5">
					{#each quick as key (key)}{@render cell(key, key)}{/each}
					<!-- Where the set is picked (#2722): it left crew settings for
					     the rider's own, and this row is where they meet it. -->
					<a
						href="/settings/profile"
						onclick={onClose}
						title="Change your reactions"
						aria-label="Change your reactions"
						class="text-muted hover:text-ink hover:bg-surface-raised grid h-9 w-9 place-items-center rounded"
						><Pencil size={16} /></a
					>
				</div>
			{/if}
			{#if crewId}
				<p class="eyebrow px-1 pt-2 pb-1">The crew's emoji</p>
				<div class="grid grid-cols-8 gap-0.5">
					{#each custom as e (e.id)}{@render crewCell(e.name, e.id)}{/each}
					<!-- Where a member adds one (#2643): the crew's settings page
					     carries the list for everyone, not only its admins. -->
					<a
						href="/crew/{crewId}/settings#emoji"
						onclick={onClose}
						title="Add an emoji to the crew"
						aria-label="Add an emoji to the crew"
						class="text-muted hover:text-ink hover:bg-surface-raised grid h-9 w-9 place-items-center rounded"
						><Plus size={16} /></a
					>
				</div>
			{/if}
			{#if recent.length}
				<p class="eyebrow px-1 pt-2 pb-1">Recent</p>
				<div class="grid grid-cols-8 gap-0.5">
					{#each recent as key (key)}{@render cell(key, key)}{/each}
				</div>
			{/if}
		{:else if groups[tab]}
			<p class="eyebrow px-1 pb-1">{groups[tab].label}</p>
			<div class="grid grid-cols-8 gap-0.5">
				{#each groups[tab].emoji as e (e.unicode)}{@render cell(
						e.unicode,
						e.label,
					)}{/each}
			</div>
		{/if}
	</div>
</div>
