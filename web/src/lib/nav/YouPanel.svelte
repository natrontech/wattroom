<script lang="ts">
	// You, pinned at the sidebar's foot: your name, your status and Settings.
	// The voice controls moved to the now bar along the bottom of the content.
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	import { account } from '$lib/account.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { activeHref } from '$lib/nav/pages';
	import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
	import { friends } from '$lib/friends/friends.svelte';
	import { UNREAD_DOT } from '$lib/messages/unread-marks';
	import { youMenu } from '$lib/nav/you-menu';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { statusOfRider } from '$lib/status';
	import Settings from '@lucide/svelte/icons/settings';

	// The route is the one thing the store cannot answer.
	let { pathname }: { pathname: string } = $props();

	const conn = $derived(channelConnection.current);
	const destination = $derived(activeHref(pathname));
	// Your Home has news (#2586): a friend waiting on your answer.
	const news = $derived(
		pathname !== '/home' && friends.waiting > 0
			? `${friends.waiting} waiting for you to answer`
			: '',
	);
	// The dot on your own avatar: away is yours to set, riding is the voice
	// channel's to report (#1016).
	const myStatus = $derived(
		conn
			? statusOfRider({
					away: conn.av.away,
					riding: conn.live.tick?.roster.find(
						(rider) => rider.id === account.me?.id,
					)?.riding,
				})
			: null,
	);
</script>

<!-- The same shape whatever the connection state: the nav above never jumps. -->
<div
	class="border-ink/5 border-t px-3 py-2.5"
	{@attach contextMenu(() => youMenu(goto))}
>
	<div class="flex items-center gap-2" title={MENU_HINT}>
		<!-- You, one click from any crew (#2581): the switcher's You, without
		     opening the switcher — the YOU section that tried to be this
		     listed Workouts twice. Your rider page is Home's level tile and
		     this card's menu. Home's row is the lit one, so this never is. -->
		<a
			href="/home"
			onclick={() => chosenCrew.set('you')}
			class="hover:bg-ink/5 mr-auto -ml-1 flex min-w-0 items-center gap-2 rounded py-0.5 pr-2 pl-1"
			title="you — your own Home, workouts, rides and music"
		>
			<span class="relative shrink-0">
				<Avatar
					name={account.me?.displayName ?? ''}
					avatarUrl={account.me?.avatarUrl}
					xp={account.me?.totalXp}
					status={myStatus}
					size={26}
				/>
				{#if news}
					<span
						class="{UNREAD_DOT} ring-surface absolute -top-0.5 -right-0.5 ring-2"
						title={news}
						data-testid="you-news"
					></span>
					<span class="sr-only">{news}</span>
				{/if}
			</span>
			<span class="min-w-0">
				<span class="flex min-w-0 items-center gap-1 text-xs font-medium">
					<span class="truncate">{account.me?.displayName ?? ''}</span>
					<StatusMark line={account.me?.statusLine} size={12} />
				</span>
			</span>
		</a>
		<!-- Everything that is a setting rather than a destination: profile,
		     sensors, ramp test, devices, the mixer, the gate, the theme. -->
		<a
			href="/settings"
			class="grid h-11 w-11 shrink-0 place-items-center rounded md:h-7 md:w-7 {destination ===
				undefined && pathname.startsWith('/settings')
				? 'text-ink'
				: 'text-muted hover:bg-ink/5 hover:text-ink'}"
			title="Settings"
			aria-label="Settings"><Settings size={16} /></a
		>
	</div>
</div>
