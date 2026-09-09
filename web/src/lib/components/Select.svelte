<script lang="ts">
	// The kit's dropdown (#145). Chrome, not data: muted borders, neon only as
	// the open-state structural accent, nothing glows (ADR-0005). Tap targets
	// sized for a rider mid-interval; keyboard and screen-reader behaviour is
	// part of the component, not a follow-up.
	import { dropsUp } from './select-drop';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let {
		options,
		value = $bindable(),
		label,
		onchange,
	}: {
		options: { value: string; label: string }[];
		value?: string;
		/** Accessible name for the trigger. */
		label: string;
		onchange?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let active = $state(0);
	let query = $state('');
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLUListElement | null>(null);
	// A picker at the bottom of a tall modal drops its list off the fold, and
	// the last device is then unreachable (#945). Measured on open, not in an
	// effect: the trigger does not move while the list is up.
	let above = $state(false);
	// The APG select-only combobox: focus stays on the trigger (or the
	// filter) while the arrows move `active`, so aria-activedescendant names
	// the row and the trigger's name carries the value — a reader used to
	// hear "trainer, button" and nothing about which one (audit 2026-09-09).
	const uid = $props.id();
	const optionId = (i: number) => `${uid}-o${i}`;

	const selected = $derived(
		options.find((option) => option.value === value) ?? options[0],
	);
	// Type-to-filter (#175): long lists (workouts) narrow as you type.
	const shown = $derived(
		query
			? options.filter((option) =>
					option.label.toLowerCase().includes(query.toLowerCase()),
				)
			: options,
	);

	function openList() {
		query = '';
		active = Math.max(
			0,
			options.findIndex((option) => option.value === value),
		);
		const box = trigger?.getBoundingClientRect();
		// ponytail: the panel's own height is assumed full — no per-list
		// measuring, which would need the list mounted to measure.
		above = !!box && dropsUp(box, window.innerHeight);
		open = true;
	}

	function choose(next: string) {
		value = next;
		open = false;
		trigger?.focus();
		onchange?.(next);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!open) {
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
				event.preventDefault();
				openList();
			}
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				active = Math.min(shown.length - 1, active + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				active = Math.max(0, active - 1);
				break;
			case 'Enter':
				event.preventDefault();
				if (shown[active]) choose(shown[active].value);
				break;
			case 'Escape':
				event.preventDefault();
				// One layer: the dialog under this list must not close with it
				// (audit 2026-09-09).
				event.stopPropagation();
				open = false;
				trigger?.focus();
				break;
			case 'Tab':
				open = false;
				break;
		}
	}
</script>

<svelte:window
	onclick={(event) => {
		if (
			open &&
			!trigger?.contains(event.target as Node) &&
			!list?.contains(event.target as Node)
		)
			open = false;
	}}
/>

<!--
	`block`, not `inline-block`: shrink-to-fit sizes the control by its own
	longest label, so a device named "Arctis Nova Pro Wireless (1038:12e0)"
	widened it out of its grid cell and over the next picker, and the trigger's
	own `truncate` never fired (#945).
-->
<div class="relative block w-full">
	<button
		bind:this={trigger}
		type="button"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? `${uid}-list` : undefined}
		aria-label="{label}: {selected?.label ?? ''}"
		aria-activedescendant={open ? optionId(active) : undefined}
		{onkeydown}
		onclick={() => (open ? (open = false) : openList())}
		class="flex min-h-11 w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm {open
			? 'border-neon/50'
			: 'border-muted/25 hover:border-muted/60'}"
	>
		<span class="min-w-0 flex-1 truncate">{selected?.label ?? ''}</span>
		<ChevronDown size={14} class="text-muted shrink-0" />
	</button>

	{#if open}
		<!-- Width of the trigger, never wider: `min-w-max` sized the panel to
		     the longest device name and ran it off the edge of the dialog. Long
		     labels wrap instead. -->
		<div
			class="border-muted/25 bg-surface-raised absolute z-50 w-full rounded border shadow-lg shadow-black/40 {above
				? 'bottom-full mb-1'
				: 'top-full mt-1'}"
		>
			{#if options.length > 6}
				<input
					value={query}
					oninput={(e) => {
						query = e.currentTarget.value;
						active = 0;
					}}
					onkeydown={(e) => {
						if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key))
							onkeydown(e);
					}}
					placeholder="Filter…"
					aria-label="filter {label}"
					aria-controls="{uid}-list"
					aria-activedescendant={optionId(active)}
					class="placeholder:text-muted/60 border-ink/5 w-full border-b bg-transparent px-3 py-2 text-xs outline-none"
					{@attach (node) => node.focus()}
				/>
			{/if}
			<ul
				bind:this={list}
				id="{uid}-list"
				role="listbox"
				aria-label={label}
				class="max-h-64 overflow-y-auto py-1"
			>
				{#each shown as option, i (option.value)}
					<li
						id={optionId(i)}
						role="option"
						aria-selected={option.value === value}
					>
						<button
							type="button"
							tabindex="-1"
							onclick={() => choose(option.value)}
							onmouseenter={() => (active = i)}
							class="w-full px-3 py-2.5 text-left text-sm break-words {i ===
							active
								? 'bg-surface text-ink'
								: option.value === value
									? 'text-ink'
									: 'text-muted'}"
						>
							{option.label}
						</button>
					</li>
				{:else}
					<li class="text-muted px-3 py-2 text-xs">Nothing matches.</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
