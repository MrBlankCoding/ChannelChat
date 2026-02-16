<script lang="ts">
	import Avatar from './Avatar.svelte';
	import MessageActions from './MessageActions.svelte';
	import { messages, sendMessage, sendReadReceipt, sendReaction, sendEdit, sendDelete, type Message } from '$lib/chat';
	import { user } from '$lib/auth';
	import { onMount } from 'svelte';
	import { Smile, Send, Check, CheckCheck, X, MessageCircle } from 'lucide-svelte';

	let { selectedFriend, friendsStatus } = $props();
	
	let chatMessage = $state('');
	let replyingTo = $state<Message | null>(null);
	let editingMessage = $state<Message | null>(null);
	
	let showEmojiPicker = $state(false);
	let pickerContainer: HTMLElement;
	let messagesContainer: HTMLElement;

	onMount(async () => {
		await import('emoji-picker-element');
	});

	function handleSendMessage() {
		if (!chatMessage.trim() || !selectedFriend) return;
		if (editingMessage) {
			sendEdit(selectedFriend.uid, editingMessage.id, chatMessage);
			editingMessage = null;
		} else {
			sendMessage(selectedFriend.uid, chatMessage, replyingTo || undefined);
			replyingTo = null;
		}
		chatMessage = '';
		showEmojiPicker = false;
	}

	function startEdit(msg: Message) {
		editingMessage = msg;
		chatMessage = msg.content;
		replyingTo = null;
	}

	function cancelAction() {
		replyingTo = null;
		editingMessage = null;
		chatMessage = '';
	}

	let currentMessages = $derived($messages.filter(m => 
		selectedFriend && (m.senderUid === selectedFriend.uid || m.receiverUid === selectedFriend.uid)
	));

	$effect(() => {
		if (selectedFriend && currentMessages.some(m => m.senderUid === selectedFriend.uid && !m.read)) {
			sendReadReceipt(selectedFriend.uid);
		}
	});

	$effect(() => {
		if (currentMessages && messagesContainer) {
			setTimeout(() => {
				messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
			}, 0);
		}
	});

	function handleEmojiClick(event: any) {
		chatMessage += event.detail.unicode;
	}

	function handleClickOutside(event: MouseEvent) {
		if (showEmojiPicker && pickerContainer && !pickerContainer.contains(event.target as Node)) {
			showEmojiPicker = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="main-chat">
	{#if selectedFriend}
		<header class="chat-header">
			<Avatar src={selectedFriend.photoUrl} name={selectedFriend.username} />
			<div class="chat-title-info">
				<span class="chat-name">{selectedFriend.username}</span>
				<span class="chat-status">{friendsStatus[selectedFriend.uid] || 'offline'}</span>
			</div>
		</header>

		<div class="messages-container" bind:this={messagesContainer}>
			{#each currentMessages as msg (msg.id)}
				<div class="message-row {msg.senderUid === $user?.uid ? 'sent' : 'received'}">
					<div class="message-bubble-wrapper">
						<MessageActions 
							message={msg} 
							onreply={() => { replyingTo = msg; editingMessage = null; }}
							onreact={(emoji) => sendReaction(selectedFriend.uid, msg.id, emoji)}
							onedit={() => startEdit(msg)}
							ondelete={() => sendDelete(selectedFriend.uid, msg.id)}
						/>
						
						<div class="message-bubble {msg.isDeleted ? 'deleted' : ''}">
							{#if msg.replyTo && !msg.isDeleted}
								<div class="reply-quote">
									<div class="reply-line"></div>
									<div class="reply-content-box">
										<span class="reply-author">
											{msg.senderUid === $user?.uid ? 'You' : selectedFriend.username}
										</span>
										<p class="reply-text">{msg.replyContent || 'Original message'}</p>
									</div>
								</div>
							{/if}

							<div class="message-text">
								{msg.content}
								{#if msg.isEdited}<span class="edited-tag">(edited)</span>{/if}
							</div>

							<div class="message-footer">
								<span class="message-time">
									{new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								</span>
								{#if msg.senderUid === $user?.uid}
									<span class="read-status {msg.read ? 'read' : ''}">
										{#if msg.read}
											<CheckCheck size={14} />
										{:else}
											<Check size={14} />
										{/if}
									</span>
								{/if}
							</div>

							{#if msg.reactions && !msg.isDeleted}
								<div class="reactions-list">
									{#each Object.entries(msg.reactions) as [emoji, uids]}
										{#if uids.length > 0}
											<button class="reaction-pill {uids.includes($user?.uid || '') ? 'mine' : ''}" 
												 onclick={() => sendReaction(selectedFriend.uid, msg.id, emoji)}>
												{emoji} <span>{uids.length}</span>
											</button>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<footer class="chat-footer">
			{#if replyingTo || editingMessage}
				<div class="action-preview">
					<div class="action-line"></div>
					<div class="action-details">
						<span class="action-label">{editingMessage ? 'Editing message' : `Replying to ${replyingTo?.senderUid === $user?.uid ? 'yourself' : selectedFriend.username}`}</span>
						<p class="action-text">{editingMessage?.content || replyingTo?.content}</p>
					</div>
					<button class="close-btn" onclick={cancelAction}><X size={18} /></button>
				</div>
			{/if}

			<div class="input-wrapper">
				<div class="emoji-picker-wrapper" bind:this={pickerContainer}>
					<button class="icon-button emoji-btn" onclick={(e) => toggleEmojiPicker(e)}>
						<Smile size={24} />
					</button>
					{#if showEmojiPicker}
						<div class="emoji-picker-popover">
							<emoji-picker onemoji-click={handleEmojiClick} class="dark"></emoji-picker>
						</div>
					{/if}
				</div>
				<input type="text" bind:value={chatMessage} placeholder={editingMessage ? "Edit message..." : "Type a message"} onkeydown={(e) => e.key === 'Enter' && handleSendMessage()} />
				<button class="icon-button send-btn" onclick={handleSendMessage} disabled={!chatMessage.trim()}>
					{#if editingMessage}
						<Check size={24} />
					{:else}
						<Send size={24} />
					{/if}
				</button>
			</div>
		</footer>
	{:else}
		<div class="no-chat-selected">
			<MessageCircle size={80} color="var(--text-muted)" strokeWidth={1} />
			<h2>ChannelChat</h2>
			<p>Select a friend to start chatting.</p>
		</div>
	{/if}
</div>

<style>
	.message-bubble-wrapper { position: relative; max-width: 65%; margin-bottom: 4px; }
	.message-bubble-wrapper:hover :global(.actions-menu-container) { display: block; }

	.message-bubble { padding: 8px 12px; border-radius: var(--radius-md); background-color: var(--bg-tertiary); color: var(--text-primary); box-shadow: var(--shadow-sm); position: relative; }
	.sent .message-bubble { background-color: #056162; color: white; border-top-right-radius: 0; }
	.received .message-bubble { border-top-left-radius: 0; }

	.reply-quote { background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); margin-bottom: 6px; display: flex; padding: 6px; font-size: 0.85em; overflow: hidden; border-left: 4px solid var(--primary); }
	.reply-line { display: none; }
	.reply-content-box { display: flex; flex-direction: column; overflow: hidden; padding-left: 4px; }
	.reply-author { color: var(--primary); font-weight: bold; font-size: 0.8em; margin-bottom: 2px; }
	.reply-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; opacity: 0.8; color: var(--text-primary); }

	.message-text { word-wrap: break-word; font-size: 1.05em; }
	.edited-tag { font-size: 0.75em; opacity: 0.6; margin-left: 4px; font-style: italic; }
	.deleted { font-style: italic; opacity: 0.6; }

	.message-footer { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 4px; }
	.message-time { font-size: 10px; opacity: 0.7; }
	.read-status { color: var(--text-muted); display: flex; align-items: center; }
	.read-status.read { color: #4fc3f7; }

	.reactions-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
	.reaction-pill { background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: var(--radius-full); padding: 2px 8px; font-size: 0.85em; cursor: pointer; display: flex; align-items: center; gap: 4px; color: var(--text-primary); transition: var(--transition-fast); }
	.reaction-pill:hover { background-color: var(--bg-hover); }
	.reaction-pill.mine { border-color: var(--primary); background: var(--primary-light); }

	.action-preview { background: var(--bg-secondary); padding: 10px var(--space-md); border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); display: flex; align-items: center; gap: 12px; position: relative; border-bottom: 1px solid var(--border-primary); border-top: 1px solid var(--border-primary); }
	.action-line { width: 4px; height: 80%; background: var(--primary); border-radius: var(--radius-sm); }
	.action-details { flex: 1; overflow: hidden; }
	.action-label { font-size: 0.75em; color: var(--primary); font-weight: bold; }
	.action-text { font-size: 0.85em; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; }

	.emoji-picker-wrapper { position: relative; display: flex; align-items: center; }
	.emoji-picker-popover { position: absolute; bottom: 60px; left: 0; z-index: 1000; box-shadow: var(--shadow-lg); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-secondary); }
	emoji-picker { height: 400px; width: 320px; }
	:global(emoji-picker.dark) { --background: var(--bg-secondary); --border-color: var(--border-primary); --indicator-color: var(--primary); --input-border-color: var(--border-primary); --input-font-color: var(--text-primary); --input-placeholder-color: var(--text-muted); }
</style>
