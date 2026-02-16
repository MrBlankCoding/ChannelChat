<script lang="ts">
	let { src = '', name = '?', size = 'md', online = false, showStatus = false } = $props();
</script>

<div class="avatar {size}">
	{#if src}
		<img {src} alt={name} class="avatar-img" loading="lazy" />
	{:else}
		<div class="avatar-fallback">{name[0].toUpperCase()}</div>
	{/if}
	
	{#if showStatus}
		<span class="status-dot {online ? 'online' : 'offline'}"></span>
	{/if}
</div>

<style>
	.avatar {
		background-color: var(--accent);
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--font-semibold);
		position: relative;
		flex-shrink: 0;
		overflow: hidden;
	}

	.md { width: 40px; height: 40px; }
	.sm { width: 32px; height: 32px; font-size: var(--text-sm); }
	.lg { width: 80px; height: 80px; font-size: var(--text-2xl); }

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.status-dot {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid var(--bg-secondary);
		z-index: 1;
	}

	.status-dot.online { background-color: var(--success); }
	.status-dot.offline { background-color: var(--text-muted); }
</style>
