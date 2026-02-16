<script lang="ts">
	import Avatar from './Avatar.svelte';
	let { friendsList, friendsStatus, selectedFriend = $bindable() } = $props();
</script>

<div class="section">
	{#each friendsList as friend (friend.uid)}
		<div class="list-item clickable {selectedFriend?.uid === friend.uid ? 'active' : ''}" onclick={() => selectedFriend = friend}>
			<Avatar 
				src={friend.photoUrl} 
				name={friend.username} 
				online={friendsStatus[friend.uid] === 'online'} 
				showStatus={true} 
			/>
			<div class="item-info">
				<span class="item-name">{friend.username}</span>
				<span class="item-status">{friendsStatus[friend.uid] || 'offline'}</span>
			</div>
		</div>
	{/each}
	{#if friendsList.length === 0}
		<div class="empty-state">No active chats.</div>
	{/if}
</div>
