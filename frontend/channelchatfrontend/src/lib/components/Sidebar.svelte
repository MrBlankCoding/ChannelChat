<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { user } from '$lib/auth';
	import { 
		MessageSquare, 
		Users, 
		Settings, 
		Menu, 
		PanelLeftClose, 
		PanelLeftOpen,
		Search,
		UserPlus,
		CheckCircle2
	} from 'lucide-svelte';

	let { 
		activeTab = $bindable(), 
		selectedFriend = $bindable(), 
		friendsList, 
		friendsStatus, 
		friendRequests, 
		searchResults = $bindable(),
		loading,
		searchQuery = $bindable(),
		cachedUser,
		onsearch,
		onsendrequest,
		onacceptrequest,
		onopensettings
	} = $props();

	let isCollapsed = $state(false);

	// View-based lazy loading
	let ChatListComp: any = $state(null);
	let FriendSearchComp: any = $state(null);

	$effect(() => {
		if (activeTab === 'chats' && !ChatListComp) {
			import('./ChatList.svelte').then(m => ChatListComp = m.default);
		} else if (activeTab === 'friends' && !FriendSearchComp) {
			import('./FriendSearch.svelte').then(m => FriendSearchComp = m.default);
		}
	});
</script>

<nav class="nav-rail">
	<div class="nav-icons">
		<button class="nav-item toggle-btn" onclick={() => isCollapsed = !isCollapsed} title={isCollapsed ? "Show Sidebar" : "Hide Sidebar"}>
			{#if isCollapsed}
				<PanelLeftOpen size={24} />
			{:else}
				<PanelLeftClose size={24} />
			{/if}
		</button>
		<div class="nav-divider"></div>
		<button class="nav-item {activeTab === 'chats' ? 'active' : ''}" onclick={() => { activeTab = 'chats'; isCollapsed = false; }} title="Chats">
			<MessageSquare size={24} />
		</button>
		<button class="nav-item {activeTab === 'friends' ? 'active' : ''}" onclick={() => { activeTab = 'friends'; isCollapsed = false; }} title="Friends">
			<Users size={24} />
		</button>
	</div>
	<div class="nav-bottom">
		<button class="nav-item" onclick={onopensettings} title="Settings">
			<Settings size={24} />
		</button>
	</div>
</nav>

<div class="sidebar {isCollapsed ? 'collapsed' : ''}">
	<header class="sidebar-header">
		<h2>{activeTab === 'chats' ? 'Chats' : 'Friends'}</h2>
	</header>

	<div class="sidebar-content">
		{#if activeTab === 'chats'}
			{#if ChatListComp}
				<ChatListComp {friendsList} {friendsStatus} bind:selectedFriend />
			{/if}
		{:else}
			{#if FriendSearchComp}
				<FriendSearchComp 
					bind:searchQuery 
					{onsearch} 
					{loading} 
					{searchResults} 
					{friendsList} 
					{friendRequests} 
					{onsendrequest} 
					{onacceptrequest} 
				/>
			{/if}
		{/if}
	</div>

	<footer class="sidebar-footer">
		<div class="user-profile">
			<Avatar src={cachedUser?.photoUrl} name={cachedUser?.email || $user?.email || 'U'} size="sm" />
			<div class="user-info-text">
				<span class="user-email">{cachedUser?.email || $user?.email}</span>
				<span class="user-status-online">Online</span>
			</div>
		</div>
	</footer>
</div>

<style>
	.nav-divider {
		height: 1px;
		background-color: var(--border-primary);
		width: 30px;
		margin: var(--space-sm) auto;
	}

	.toggle-btn {
		color: var(--text-accent);
	}
</style>
