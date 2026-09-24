<script lang="ts">
	// The board itself (ADR-0056, #2405): the grid of pins, the menu and the
	// editor. What a pin IS, and which of its lines are copyable, lives in
	// `pins.ts`; loading and saving belong to the place that draws this.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { copyText, theLinkItself } from '$lib/copy';
	import Banner from '$lib/components/Banner.svelte';
	import {
		bareLink,
		boardFull,
		isLink,
		parsePin,
		type Pin,
		type PinDraft,
	} from './pins';
	import {
		MaxCrewPins,
		MaxPinBodyChars,
		MaxPinTitleChars,
	} from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';

	let {
		pins,
		crewName = '',
		onsave,
		onremove,
	}: {
		pins: Pin[];
		/** Named in the subline, so the scope of an edit is on the page. */
		crewName?: string;
		/**
		 * Write a pin — new when `id` is absent. Resolves to the refusal, or
		 * null once it is saved: the editor stays open on a refusal with the
		 * words still in it, the way a refused chat edit does.
		 */
		onsave?: (draft: PinDraft, id?: string) => Promise<string | null>;
		/** Take one off. Resolves to the refusal, or null once it is gone. */
		onremove?: (pin: Pin) => Promise<string | null>;
	} = $props();

	/** The pin being written, or null when the editor is shut. */
	let draft = $state<{ id?: string; title: string; body: string } | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	const ready = $derived(!!draft?.title.trim() && !!draft?.body.trim());
	/**
	 * The board's ceiling, checked here as well as by the server. Never render
	 * a button that will fail (ux.md): a rider who wrote a pin into a full
	 * board and lost it to a 409 was told too late.
	 */
	const full = $derived(boardFull(pins));

	function open(pin?: Pin) {
		saveError = null;
		draft = pin ? { ...pin } : { title: '', body: '' };
	}

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

	async function unpin(pin: Pin) {
		// Undo over confirm (errors.md): a pin is a title and some text, and
		// putting it back is exact, so nothing is lost by doing it and
		// offering the way back rather than a dialog in front of every
		// tidy-up.
		const refused = await onremove?.(pin);
		if (refused) {
			toasts.push(refused, { tone: 'error' });
			return;
		}
		// The undo re-pins rather than restoring the row: the id is the
		// server's and is gone with it, so the pin comes back at the end of
		// the board. Said plainly here rather than pretending otherwise.
		toasts.push(`Unpinned ${pin.title}.`, {
			undo: () => void onsave?.({ title: pin.title, body: pin.body }),
		});
	}

	/**
	 * Everyone in the crew pins, edits and unpins — there is no reader-only
	 * board, so there is no permission to pass in (#2405).
	 *
	 * ponytail: nobody owns a pin, so nothing checks who wrote one. It is a
	 * shared board and undo covers the mistakes; per-pin authorship is
	 * machinery for a problem a crew of friends does not have. Add it when a
	 * crew is big enough to have strangers in it.
	 */
	function entries(pin: Pin): MenuEntry[] {
		return [
			{ label: 'Edit', icon: Pencil, onSelect: () => open(pin) },
			'separator',
			{
				label: 'Unpin',
				icon: PinOff,
				danger: true,
				onSelect: () => unpin(pin),
			},
		];
	}

	async function save() {
		if (!draft || !ready || saving) return;
		const { id, title, body } = draft;
		saving = true;
		const refused = await onsave?.(
			{ title: title.trim(), body: body.trim() },
			id,
		);
		saving = false;
		if (refused) {
			// The words stay in the box, like a refused send (#865): a rider
			// who typed a door code does not retype it because the network
			// blinked.
			saveError = refused;
			return;
		}
		draft = null;
	}
</script>

{#snippet field(label: string, shown: string, full: string)}
	<!-- Label over value, so the value has the card's whole width rather
	     than what an 80px label column left it. One line, never wrapped: a
	     password split at "batte/ry" reads as two things, and it overflowed a
	     phone before that (#2400). The row copies or opens the whole value,
	     and hovering it shows the rest. -->
	<span class="min-w-0 flex-1" title={full}>
		{#if label}
			<span class="text-muted block truncate text-xs">{label}</span>
		{/if}
		<span class="block truncate font-mono text-sm">{shown}</span>
	</span>
{/snippet}

<section>
	<!-- A SECTION of the Board now (#2413), not the whole place: the page
	     above owns the title, so this is an eyebrow rather than a second
	     heading of the same size. One button to pin with — the empty state's
	     while there is nothing, this one once there is. -->
	<div class="mb-2 flex items-center gap-3">
		<h2 class="eyebrow">pins</h2>
		<!-- Said beside the label, because editing one changes it for everyone
		     in the crew and the rider has to know that before they do. -->
		{#if crewName}
			<span class="text-muted-dim truncate text-[11px]">all of {crewName}</span>
		{/if}
		{#if pins.length > 0}
			<button
				onclick={() => open()}
				disabled={full}
				title={full ? `This board is full at ${MaxCrewPins} pins.` : undefined}
				class="btn btn-secondary btn-xs ml-auto"
				><PinIcon size={13} /> Pin something</button
			>
		{/if}
	</div>

	{#if pins.length === 0}
		<!-- Teaches, never apologizes (ux.md): what the thing is, and the one
		     button that makes the first one. Everyone standing here can make
		     it, so there is no version of this that has to apologise for a
		     button it is not allowed to draw. -->
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
	{:else}
		{#if full}
			<!-- Said where the button is, not only on its hover: the disabled
			     control tells a mouse what is wrong and nobody else (ux.md). -->
			<p class="text-muted mb-3 text-xs">
				This board is full at {MaxCrewPins} pins. Unpin one to make room.
			</p>
		{/if}
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
					title={MENU_HINT}
					{@attach contextMenu(() => entries(pin))}
				>
					<!-- The title row carries Edit (#2411). It used to live only on
					     the context menu, and ux.md says in as many words that
					     nothing may: the menu is a shortcut, never the sole way.
					     A card whose rows copy on click gave a rider no reason to
					     think right-click held anything, and the maintainer hit
					     exactly that within minutes of the release. -->
					<div class="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
						<h3 class="font-display min-w-0 flex-1 truncate font-semibold">
							{pin.title}
						</h3>
						<button
							onclick={() => open(pin)}
							class="text-muted hover:text-ink icon-btn"
							aria-label="Edit {pin.title}"
							title="Edit"><Pencil size={14} /></button
						>
					</div>
					{#each parsePin(pin.body) as line, i (i)}
						{#if line.kind === 'text'}
							<!-- Chat's own renderer, so a crew emoji in a pin is its
							     picture rather than its `:name:`. -->
							<p class="text-muted px-4 py-2 text-xs">
								<MessageText text={line.text} preview={false} />
							</p>
						{:else if isLink(line.value)}
							<!-- The row is the target, not the icon beside it: a
							     rider reaching for this is often on a bike. -->
							<a
								href={line.value}
								target="_blank"
								rel="noreferrer noopener"
								class="hover:bg-ink/5 flex items-center gap-3 px-4 py-2"
							>
								{@render field(line.label, bareLink(line.value), line.value)}
								<ExternalLink size={14} class="text-muted shrink-0" />
							</a>
						{:else}
							<button
								onclick={() => copy(line.label, line.value)}
								class="hover:bg-ink/5 flex w-full items-center gap-3 px-4 py-2 text-left"
							>
								{@render field(line.label, line.value, line.value)}
								<Copy size={14} class="text-muted shrink-0" />
							</button>
						{/if}
					{/each}
					<div class="pb-2"></div>
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
				maxlength={MaxPinTitleChars}
				placeholder="Minecraft"
				class="input mt-1 w-full"
			/>
		</label>
		<label class="mt-3 block">
			<span class="eyebrow">what to know</span>
			<textarea
				bind:value={draft.body}
				maxlength={MaxPinBodyChars}
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
		<p class="text-muted mt-2 text-xs">
			Everyone in the crew can read a pin, and change one.
		</p>
		{#if saveError}
			<!-- A submit failure is a banner atop its form (errors.md), not a
			     toast that outlives the dialog it belongs to. -->
			<div class="mt-4"><Banner tone="error">{saveError}</Banner></div>
		{/if}
		<div class="mt-5 flex flex-row-reverse flex-wrap justify-end gap-2">
			<button onclick={() => (draft = null)} class="btn btn-secondary btn-lg"
				>Cancel</button
			>
			<button
				onclick={save}
				disabled={!ready || saving}
				class="btn btn-primary btn-lg">{draft.id ? 'Save' : 'Pin it'}</button
			>
		</div>
	</Modal>
{/if}
