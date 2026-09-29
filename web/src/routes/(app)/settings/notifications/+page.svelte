<script lang="ts">
	import HiddenRiders from '$lib/profile/HiddenRiders.svelte';
	import LaunchAtLogin from '$lib/profile/LaunchAtLogin.svelte';
	import Notifications from '$lib/profile/Notifications.svelte';
</script>

<Notifications />
<!-- What reaches you, person by person (#3202): the riders you hid. -->
<HiddenRiders />
<!-- The desktop shell's own switch (#1313): what WattRoom does to this
     machine, beside the other thing it does to it. Nothing in a browser. -->
<LaunchAtLogin />
