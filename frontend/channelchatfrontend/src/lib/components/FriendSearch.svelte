<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { user } from '$lib/auth';

	let { 
		searchQuery = $bindable(), 
		onsearch, 
		loading, 
		searchResults, 
		friendsList, 
		friendRequests, 
		onsendrequest, 
		onacceptrequest 
	} = $props();
</script>

<div class="search-container">
	<div class="search-input-wrapper">
		<input type="text" bind:value={searchQuery} oninput={onsearch} placeholder="Search users" />
	</div>
</div>

<div class="sidebar-content">
	{#if searchResults.length > 0}
		<div class="section">
			<div class="section-header">SEARCH RESULTS</div>
			{#each searchResults as result (result.uid)}
				<div class="list-item">
					<Avatar src={result.photoUrl} name={result.username} size="sm" />
					<div class="item-info">
						<span class="item-name">{result.username}</span>
					</div>
					{#if result.uid !== $user?.uid}
						{#if friendsList.some(f => f.uid === result.uid)}
							<span class="status-badge">Friend</span>
						{:else}
							<button class="action-btn" onclick={() => onsendrequest(result.uid)}>Add</button>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="section">
		<div class="section-header">REQUESTS ({friendRequests.length})</div>
		{#each friendRequests as req (req.fromUid)}
			<div class="list-item">
				<Avatar src={req.fromPhotoUrl} name={req.fromUsername} size="sm" />
				<div class="item-info">
					<span class="item-name">{req.fromUsername}</span>
				</div>
				<button class="action-btn success" onclick={() => onacceptrequest(req.fromUid)}>Accept</button>
			</div>
		{/each}
	</div>
</div>
