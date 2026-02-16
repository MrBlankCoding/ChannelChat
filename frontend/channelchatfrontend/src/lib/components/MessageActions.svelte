<script lang="ts">
	import { user } from '$lib/auth';
	import { 
		Smile, 
		Reply, 
		Pencil, 
		Trash2 
	} from 'lucide-svelte';

	let { message, onreply, onreact, onedit, ondelete } = $props();

	const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
	let showEmojiSelector = $state(false);
</script>

<div class="actions-menu-container">
	{#if showEmojiSelector}
		<div class="emoji-selector" onmouseenter={() => showEmojiSelector = true} onmouseleave={() => showEmojiSelector = false}>
			{#each quickEmojis as emoji}
				<button class="emoji-btn" onclick={() => { onreact(emoji); showEmojiSelector = false; }}>
					{emoji}
				</button>
			{/each}
		</div>
	{/if}

	<div class="main-actions">
		<button class="action-item" onclick={() => showEmojiSelector = !showEmojiSelector} title="React">
			<Smile size={16} />
		</button>
		<button class="action-item" onclick={onreply} title="Reply">
			<Reply size={16} />
		</button>
		{#if message.senderUid === $user?.uid && !message.isDeleted}
			<button class="action-item" onclick={onedit} title="Edit">
				<Pencil size={16} />
			</button>
			<button class="action-item delete" onclick={ondelete} title="Delete">
				<Trash2 size={16} />
			</button>
		{/if}
	</div>
</div>

<style>
	.actions-menu-container {
		position: absolute;
		top: -35px;
		right: 0;
		display: none;
		z-index: 10;
		padding-bottom: 5px;
	}

	.main-actions {
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		display: flex;
		padding: 2px;
		box-shadow: var(--shadow-md);
	}

	.action-item {
		background: transparent;
		color: var(--text-secondary);
		padding: 4px 8px;
		border: none;
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
	}

	.action-item:hover {
		background-color: var(--bg-hover);
		color: var(--text-primary);
	}

	.action-item.delete:hover {
		color: var(--error);
	}

	.emoji-selector {
		position: absolute;
		bottom: 100%;
		right: 0;
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-full);
		display: flex;
		padding: 4px;
		gap: 4px;
		margin-bottom: -2px;
		box-shadow: var(--shadow-md);
	}

	.emoji-btn {
		background: transparent;
		border: none;
		font-size: 18px;
		cursor: pointer;
		padding: 4px;
		border-radius: 50%;
		transition: transform 0.1s;
	}

	.emoji-btn:hover {
		transform: scale(1.2);
		background-color: var(--bg-hover);
	}
</style>
