<script lang="ts">
	// The curated icon set as a radiogroup (#447): a room's mark and a crew's
	// (#1209) come from the same set, drawn by the same control, so the two
	// cannot drift. Chrome, not data — the neon ring is the structural accent.
	import { ROOM_ICONS } from '$lib/icons';

	let {
		value,
		onpick,
		disabled = false,
		labelledby,
	}: {
		/** The chosen key; '' is none. */
		value: string;
		onpick: (key: string) => void;
		disabled?: boolean;
		/** id of the visible label, when there is one. */
		labelledby?: string;
	} = $props();

	/** Whether the current value names an icon in the set, else "None" is the stop. */
	const hasValue = $derived(value !== '' && value in ROOM_ICONS);
	/** Arrow keys walk the radios; Home and End jump; the walked-to one is picked. */
	function walk(event: KeyboardEvent) {
		const group = event.currentTarget as HTMLElement | null;
		if (!group) return;
		const radios = [
			...group.querySelectorAll<HTMLButtonElement>('[role=radio]'),
		];
		const at = radios.indexOf(document.activeElement as HTMLButtonElement);
		if (at < 0) return;
		const step: Record<string, number> = {
			ArrowRight: 1,
			ArrowDown: 1,
			ArrowLeft: -1,
			ArrowUp: -1,
		};
		let next = at;
		if (event.key in step)
			next = (at + step[event.key] + radios.length) % radios.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = radios.length - 1;
		else return;
		event.preventDefault();
		radios[next].focus();
		radios[next].click();
	}
</script>

<!-- A radiogroup walks by arrow keys and has one tab stop (#1971): the
     checked radio, or the first. -->
<div
	class="flex flex-wrap items-center gap-1.5"
	role="radiogroup"
	tabindex="-1"
	aria-labelledby={labelledby}
	aria-label={labelledby ? undefined : 'icon'}
	onkeydown={walk}
>
	<button
		type="button"
		role="radio"
		aria-checked={value === ''}
		tabindex={value === '' || !hasValue ? 0 : -1}
		onclick={() => onpick('')}
		{disabled}
		class="btn btn-secondary btn-xs {value === ''
			? 'ring-neon bg-neon/15 ring-1'
			: ''}">None</button
	>
	{#each Object.entries(ROOM_ICONS) as [key, Icon] (key)}
		<button
			type="button"
			role="radio"
			aria-checked={value === key}
			tabindex={value === key ? 0 : -1}
			aria-label={key}
			title={key}
			onclick={() => onpick(key)}
			{disabled}
			class="btn btn-secondary btn-xs {value === key
				? 'ring-neon bg-neon/15 ring-1'
				: ''}"><Icon size={16} /></button
		>
	{/each}
</div>
