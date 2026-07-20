<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/fraunces/full.css'; // full = incl. opsz/SOFT/WONK axes
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
