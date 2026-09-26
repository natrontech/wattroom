<script lang="ts">
	import LaunchAtLogin from '$lib/profile/LaunchAtLogin.svelte';
	import Notifications from '$lib/profile/Notifications.svelte';
</script>

<Notifications />
<!-- The desktop shell's own switch (#1313): what WattRoom does to this
     machine, beside the other thing it does to it. Nothing in a browser. -->
<LaunchAtLogin />
