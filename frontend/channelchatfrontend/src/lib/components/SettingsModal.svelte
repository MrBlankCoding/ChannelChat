<script lang="ts">
	import { user } from '$lib/auth';

	let { onclose, onlogout } = $props();
</script>

<div class="modal-backdrop" onclick={onclose}>
	<div class="modal-content" onclick={(e) => e.stopPropagation()}>
		<header class="modal-header">
			<h3>Settings</h3>
			<button class="close-btn" onclick={onclose}>&times;</button>
		</header>
		<div class="modal-body">
			<div class="setting-item">
				<span>Account</span>
				<p>{$user?.email}</p>
			</div>
			<div class="setting-item">
				<span>Theme</span>
				<p>Dark (System)</p>
			</div>
			<hr class="modal-divider" />
			<button class="logout-action-btn" onclick={onlogout}>Log Out</button>
		</div>
	</div>
</div>
