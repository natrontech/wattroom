<script lang="ts">
	/**
	 * One ride's friends-visibility, wherever it is offered (ADR-0024, #1691):
	 * the history row, that row's menu, and the ride's own page.
	 *
	 * It is a component because the words were not shared and drifted (#2167):
	 * the list said what the press DOES ("Make private" / "Share", #2004) and
	 * the ride page said what the ride IS ("Shared with friends" / "Private"),
	 * with the same `aria-pressed` under both — so on one screen a rider
	 * pressed **Private** to make a ride public. ux.md: items say what happens.
	 *
	 * The icon carries the state, the word carries the act, and the title says
	 * both. Undo over confirm is `setRideShared`'s (errors.md).
	 */
	import Lock from '@lucide/svelte/icons/lock';
	import Users from '@lucide/svelte/icons/users';
	import { setRideShared, shareAction } from '$lib/ride/share';

	let {
		ride,
		class: klass = 'btn btn-ghost btn-xs',
	}: {
		ride: { id: string; sharedWithFriends: boolean };
		class?: string;
	} = $props();

	const act = $derived(shareAction(ride.sharedWithFriends));
</script>

<button
	onclick={() => void setRideShared(ride, !ride.sharedWithFriends)}
	aria-pressed={ride.sharedWithFriends}
	title={act.title}
	class={klass}
>
	{#if ride.sharedWithFriends}
		<Users size={13} />
	{:else}
		<Lock size={13} />
	{/if}
	{act.label}
</button>
