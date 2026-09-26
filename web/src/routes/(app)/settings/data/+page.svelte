<script lang="ts">
	// Your data (#1330): what leaves the account and what reads it — the
	// export and the purge (YourData), the read-only tokens for your own AI and
	// tools (ADR-0017), and the calendar link (ADR-0021), which is the third
	// bearer secret on the account and used to be the only one filed elsewhere
	// (#1860). The purge stays last: the destructive action sits apart (#126).
	import CalendarFeed from '$lib/profile/CalendarFeed.svelte';
	import CoachAccess from '$lib/profile/CoachAccess.svelte';
	import YourData from '$lib/profile/YourData.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<CoachAccess initial={data.tokens} initialError={data.tokensError} />
<CalendarFeed />
<YourData />
