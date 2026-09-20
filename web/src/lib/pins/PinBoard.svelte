<script lang="ts">
	// The board itself (#2405): the grid of pins, the menu and the editor.
	// What a pin IS, and which of its lines are copyable, lives in
	// `pins.svelte.ts` — the sidebar's gate reads that too.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { copyText, theLinkItself } from '$lib/copy';
	import { isLink, parsePin, type Pin } from './pins.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';

	let {
		pins,
		canEdit = false,
		crewName = '',
		onsave,
		onremove,
	}: {
		pins: Pin[];
		/** Crew admins pin; everyone else reads and copies. */
		canEdit?: boolean;
		/** Named in the subline, so the scope of an edit is on the page. */
		crewName?: string;
		/** A new pin has no id yet. */
		onsave?: (pin: Pin | Omit<Pin, 'id'>) => void;
		onremove?: (pin: Pin) => void;
	} = $props();

	/** The pin being written, or null when the editor is shut. */
	let draft = $state<{ id?: string; title: string; body: string } | null>(null);
	const ready = $derived(!!draft?.title.trim() && !!draft?.body.trim());

	const PLACEHOLDER = `Address: mc.natron.io:25565
Password: kilojoule-hammer-42

Whitelist is on — ask Nina.`;

	function copy(label: string, value: string) {
		void copyText(
			value,
			label ? `Copied ${label.toLowerCase()}.` : 'Copied.',
			isLink(value) ? theLinkItself(value) : undefined,
		);
	}

	function unpin(pin: Pin) {
		// Undo over confirm (errors.md): a pin is a title and some text, and
		// putting it back is exact, so nothing is lost by doing it and
		// offering the way back rather than a dialog in front of every
		// tidy-up.
		onremove?.(pin);
		toasts.push(`Unpinned ${pin.title}.`, { undo: () => onsave?.(pin) });
	}

	/** Only an editor has a menu: every row is already tappable to copy. */
	function entries(pin: Pin): MenuEntry[] {
		if (!canEdit) return [];
		return [
			{ label: 'Edit', icon: Pencil, onSelect: () => (draft = { ...pin }) },
			'separator',
			{
				label: 'Unpin',
				icon: PinOff,
				danger: true,
				onSelect: () => unpin(pin),
			},
		];
	}

	function save() {
		if (!draft || !ready) return;
		const { id, title, body } = draft;
		onsave?.({
			...(id ? { id } : {}),
			title: title.trim(),
			body: body.trim(),
		} as Pin);
		draft = null;
	}
</script>

{#snippet value(text: string)}
	<!-- A server address is one long unbreakable token, which is exactly what
	     overflowed a phone in #2400. It wraps rather than widening the page. -->
	<span class="min-w-0 flex-1 font-mono text-sm break-all">{text}</span>
{/snippet}

<section>
	<!-- The place's own head, drawn the way Sessions draws its: the room's
	     name is the sidebar's job (ADR-0020), so this says which place you are
	     standing in. One button to pin with — the empty state's while the
	     board is empty, this one once it is not. -->
	<div class="mb-1 flex items-center gap-3">
		<h2 class="font-display text-xl font-bold">Pins</h2>
		{#if canEdit && pins.length > 0}
			<button
				onclick={() => (draft = { title: '', body: '' })}
				class="btn btn-primary btn-xs ml-auto"
				><PinIcon size={13} /> Pin something</button
			>
		{/if}
	</div>
	<!-- Says the scope, because editing here changes them everywhere: the crew
	     owns pins, and its other rooms show the same board. -->
	<p class="text-muted mb-5 text-xs">
		What the crew keeps needing. The same board in every room{crewName
			? ` of ${crewName}`
			: ''}.
	</p>

	{#if pins.length === 0}
		{#if canEdit}
			<!-- Teaches, never apologizes (ux.md): what the thing is, and the
			     one button that makes the first one. A member with no pins to
			     read gets no board at all — there is nothing to teach them
			     about a thing only an admin can make. -->
			<EmptyState>
				{#snippet icon()}<PinIcon size={20} />{/snippet}
				What the crew keeps needing: a game server and its password, the Discord link,
				the door code.
				{#snippet cta()}
					<button
						onclick={() => (draft = { title: '', body: '' })}
						class="btn btn-secondary btn-lg">Pin something</button
					>
				{/snippet}
			</EmptyState>
		{/if}
	{:else}
		<!-- Fills the column it is in, not the viewport. `sm:grid-cols-2
		     lg:grid-cols-3` read right on a page and was wrong in a room,
		     whose content column is a good deal narrower than the window: a
		     Tailwind breakpoint asks the viewport, so three cards were
		     promised space the room never had. auto-fill asks the container,
		     which is the thing that actually decides.

		     `items-start` so a pin with four lines does not stretch the short
		     one beside it into a card of mostly nothing. -->
		<ul
			class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] items-start gap-3"
		>
			{#each pins as pin (pin.id)}
				<li
					class="panel panel-flush overflow-hidden"
					title={canEdit ? MENU_HINT : undefined}
					{@attach contextMenu(() => entries(pin))}
				>
					<p class="eyebrow px-4 pt-3 pb-2">{pin.title}</p>
					{#each parsePin(pin.body) as line, i (i)}
						{#if line.kind === 'text'}
							<p class="text-muted px-4 pt-1 pb-3 text-xs">{line.text}</p>
						{:else if isLink(line.value)}
							<!-- The row is the target, not the icon beside it: a
							     rider reaching for this is often on a bike. -->
							<a
								href={line.value}
								target="_blank"
								rel="noreferrer noopener"
								class="hover:bg-ink/5 flex items-baseline gap-3 px-4 py-2"
							>
								{#if line.label}
									<span class="text-muted w-20 shrink-0 truncate text-xs"
										>{line.label}</span
									>
								{/if}
								{@render value(line.value)}
								<ExternalLink size={13} class="text-muted shrink-0" />
							</a>
						{:else}
							<button
								onclick={() => copy(line.label, line.value)}
								class="hover:bg-ink/5 flex w-full items-baseline gap-3 px-4 py-2 text-left"
							>
								{#if line.label}
									<span class="text-muted w-20 shrink-0 truncate text-xs"
										>{line.label}</span
									>
								{/if}
								{@render value(line.value)}
								<Copy size={13} class="text-muted shrink-0" />
							</button>
						{/if}
					{/each}
					<div class="pb-1"></div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if draft}
	<Modal
		label={draft.id ? 'Edit pin' : 'Pin something'}
		onclose={() => (draft = null)}
	>
		<h2 class="font-display text-lg leading-tight font-bold">
			{draft.id ? 'Edit pin' : 'Pin something'}
		</h2>
		<!-- The inputs come first in the DOM, so the trap's initial focus lands
		     in the title and typing works on open (ux.md's keyboard rule). -->
		<label class="mt-4 block">
			<span class="eyebrow">title</span>
			<input
				bind:value={draft.title}
				maxlength="40"
				placeholder="Minecraft"
				class="input mt-1 w-full"
			/>
		</label>
		<label class="mt-3 block">
			<span class="eyebrow">what to know</span>
			<textarea
				bind:value={draft.body}
				maxlength="1000"
				rows="6"
				placeholder={PLACEHOLDER}
				class="input mt-1 w-full resize-y font-mono text-xs"></textarea>
		</label>
		<!-- Teaches the one rule the parser has, where it is being used. A
		     field repeater would not need saying — and would need building,
		     and filling in, for the same result. -->
		<p class="text-muted mt-2 text-xs">
			A line written as <code>Label: value</code> gets its own copy button. Everything
			else stays as you wrote it.
		</p>
		<!-- No mask and no reveal-on-click: every member reads a pin anyway, so
		     hiding it is theatre that costs a tap. Say it plainly instead. -->
		<p class="text-muted mt-2 text-xs">Everyone in the crew can read a pin.</p>
		<div class="mt-5 flex flex-row-reverse flex-wrap justify-end gap-2">
			<button onclick={() => (draft = null)} class="btn btn-secondary btn-lg"
				>Cancel</button
			>
			<button onclick={save} disabled={!ready} class="btn btn-primary btn-lg"
				>{draft.id ? 'Save' : 'Pin it'}</button
			>
		</div>
	</Modal>
{/if}
