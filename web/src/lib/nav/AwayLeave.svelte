<script lang="ts">
	// Away and the way out of where you are. `docked` is the sidebar's foot on a
	// desk, where the split button takes the row; riding or on a phone they
	// sit at the end of the now bar.
	import { leaveChannel } from '#lib/channel/leave.ts';
	import { account } from '#lib/account.svelte.ts';
	import { contextMenu, openMenu } from '#lib/context-menu.svelte.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { rideBar } from '#lib/nav/ride-bar.svelte.ts';
	import { AWAY_CHOICES, AWAY_STATES, awayState } from '#lib/away.ts';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LogOut from '@lucide/svelte/icons/log-out';

	let { docked = false }: { docked?: boolean } = $props();

	const conn = $derived(channelConnection.call);
	const place = $derived(channelConnection.current);
	const away = $derived(conn?.av.away ?? false);
	// The button wears the state's glyph only once it says "I'm back".
	const myAwayReason = $derived(
		conn?.live.tick?.roster.find((rider) => rider.id === account.me?.id)
			?.awayReason ?? '',
	);
	const awayFace = $derived(awayState(away ? myAwayReason : ''));
	const label = $derived(
		docked ? '' : rideBar.on ? 'sr-only' : 'max-md:sr-only',
	);

	// The connection's setAway: it mutes this device and tells the channel.
	const setAway = (next: boolean, reason = '') => conn?.setAway(next, reason);
	const awayItems = () =>
		AWAY_CHOICES.map((key) => ({
			label: AWAY_STATES[key].label,
			icon: AWAY_STATES[key].icon,
			onSelect: () => setAway(true, key),
		}));
</script>

<!-- A split button (#706): the face is always Away, the arrow the named
     states. -->
{#if conn}<div class="flex {docked ? 'min-w-0 grow' : ''}">
		<button
			onclick={() => setAway(!away, '')}
			aria-pressed={away}
			{@attach contextMenu(awayItems)}
			class="btn min-h-11 {docked ? 'grow' : ''} {away
				? 'btn-primary'
				: 'btn-secondary'} {away ? '' : 'rounded-r-none'}"
			><awayFace.icon size={14} />
			<span class={label}>{away ? "I'm back" : 'Away'}</span></button
		>
		{#if !away}
			<button
				onclick={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					openMenu(awayItems(), box.right, box.top, event.currentTarget);
				}}
				aria-label="Choose a state"
				aria-haspopup="menu"
				class="btn btn-secondary min-h-11 min-w-11 rounded-l-none px-2 {docked
					? ''
					: 'max-sm:hidden'}"><ChevronDown size={14} /></button
			>
		{/if}
	</div>{/if}
<!-- The way out of the channel (#2447). Quiet: leaving is re-doable. -->
{#if place}<button
		onclick={leaveChannel}
		class="btn btn-secondary min-h-11 min-w-11 px-2"
		title="leave {place.address.name}"
		><LogOut size={14} />
		<span class={label}>Leave</span></button
	>{/if}
