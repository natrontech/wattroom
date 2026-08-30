<script lang="ts">
	// The kit's dropdown (#145). Chrome, not data: muted borders, neon only as
	// the open-state structural accent, nothing glows (ADR-0005). Tap targets
	// sized for a rider mid-interval; keyboard and screen-reader behaviour is
	// part of the component, not a follow-up.
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
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLUListElement | null>(null);

	const selected = $derived(
		options.find((option) => option.value === value) ?? options[0],
	);

	function openList() {
		active = Math.max(
			0,
			options.findIndex((option) => option.value === value),
		);
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
				active = Math.min(options.length - 1, active + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				active = Math.max(0, active - 1);
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				choose(options[active].value);
				break;
			case 'Escape':
				event.preventDefault();
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

<div class="relative inline-block">
	<button
		bind:this={trigger}
		type="button"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={label}
		{onkeydown}
		onclick={() => (open ? (open = false) : openList())}
		class="flex min-h-11 w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm {open
			? 'border-neon/50'
			: 'border-muted/25 hover:border-muted/60'}"
	>
		<span class="min-w-0 flex-1 truncate">{selected?.label ?? ''}</span>
		<span class="text-muted text-[10px]">▾</span>
	</button>

	{#if open}
		<ul
			bind:this={list}
			role="listbox"
			aria-label={label}
			class="border-muted/25 bg-surface-raised absolute z-50 mt-1 max-h-64 w-full min-w-max overflow-y-auto rounded border py-1 shadow-lg shadow-black/40"
		>
			{#each options as option, i (option.value)}
				<li role="option" aria-selected={option.value === value}>
					<button
						type="button"
						tabindex="-1"
						onclick={() => choose(option.value)}
						onmouseenter={() => (active = i)}
						class="w-full px-3 py-2.5 text-left text-sm {i === active
							? 'bg-surface text-white'
							: option.value === value
								? 'text-white'
								: 'text-muted'}"
					>
						{option.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
