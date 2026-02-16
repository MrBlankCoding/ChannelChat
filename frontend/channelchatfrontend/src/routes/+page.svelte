<script lang="ts">
	import { user } from '$lib/auth';
	import { fetchWithAuth } from '$lib/api';
	import { db, auth } from '$lib/firebase';
	import { ref, onValue } from 'firebase/database';
	import { onMount, untrack } from 'svelte';
	import { connectToChat } from '$lib/chat';
	import { signOut } from 'firebase/auth';
	import LandingPage from '$lib/components/LandingPage.svelte';
	import '$lib/styles/chat_layout.css';

	// heavier components
	let Sidebar: any = $state(null);
	let ChatWindow: any = $state(null);
	let SettingsModal: any = $state(null);

	// ui
	let activeTab = $state('chats');
	let showSettingsModal = $state(false);
	let cachedUser = $state<{email: string, photoUrl: string} | null>(null);

	// data
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let friendsList = $state<any[]>([]);
	let friendRequests = $state<any[]>([]);
	let friendsStatus = $state<Record<string, string>>({});
	let loading = $state(false);
	let selectedFriend = $state<any>(null);
	let lastLoadedUid = $state<string | null>(null);

	async function loadHeavyComponents() {
		const [s, c, sm] = await Promise.all([
			import('$lib/components/Sidebar.svelte'),
			import('$lib/components/ChatWindow.svelte'),
			import('$lib/components/SettingsModal.svelte')
		]);
		Sidebar = s.default;
		ChatWindow = c.default;
		SettingsModal = sm.default;
	}

	// search smh.
	let searchTimeout: any;
	function handleSearchInput() {
		clearTimeout(searchTimeout);
		if (!searchQuery) { searchResults = []; return; }
		searchTimeout = setTimeout(searchUsers, 300);
	}

	async function searchUsers() {
		loading = true;
		try {
			const res = await fetchWithAuth(`/users/search?q=${searchQuery}`);
			searchResults = res || [];
		} catch (e: any) { console.error(e.message); } finally { loading = false; }
	}

	async function sendRequest(toUid: string) {
		try {
			await fetchWithAuth('/friends/request', { method: 'POST', body: JSON.stringify({ toUid }) });
			alert('Friend request sent!');
		} catch (e: any) { console.error(e.message); }
	}

	async function acceptRequest(fromUid: string) {
		try {
			await fetchWithAuth('/friends/accept', { method: 'POST', body: JSON.stringify({ fromUid }) });
			loadAll(true);
		} catch (e: any) { console.error(e.message); }
	}

	function setupStatusListeners() {
		friendsList.forEach(friend => {
			const statusRef = ref(db, `/status/${friend.uid}`);
			onValue(statusRef, (snapshot) => {
				const val = snapshot.val();
				friendsStatus[friend.uid] = val ? val.state : 'offline';
			});
		});
	}

	async function loadAll(forceRefresh = false) {
		if (!$user) return;
		if (!forceRefresh && lastLoadedUid === $user.uid) return;
		lastLoadedUid = $user.uid;

		// ASAP!
		loadHeavyComponents();

		const userCacheKey = `user_profile_${$user.uid}`;
		const cachedU = localStorage.getItem(userCacheKey);
		if (cachedU) cachedUser = JSON.parse(cachedU);

		const cacheKey = `friends_${$user.uid}`;
		const cached = localStorage.getItem(cacheKey);
		let hasFriendsCache = false;
		if (cached) {
			friendsList = JSON.parse(cached);
			if (friendsList.length > 0 && !selectedFriend) selectedFriend = friendsList[0];
			setupStatusListeners();
			hasFriendsCache = true;
		}

		connectToChat();

		if (hasFriendsCache && !forceRefresh) {
			fetchWithAuth('/friends/requests').then(res => { friendRequests = res || []; }).catch(() => {});
			return;
		}

		try {
			const friends = await fetchWithAuth('/friends');
			friendsList = friends || [];
			localStorage.setItem(cacheKey, JSON.stringify(friendsList));
			if (friendsList.length > 0 && !selectedFriend) selectedFriend = friendsList[0];
			setupStatusListeners();

			if (auth.currentUser) {
				const currentU = { email: auth.currentUser.email || '', photoUrl: auth.currentUser.photoURL || '' };
				cachedUser = currentU;
				localStorage.setItem(userCacheKey, JSON.stringify(cachedUser));
			}

			const requests = await fetchWithAuth('/friends/requests');
			friendRequests = requests || [];
		} catch (e: any) { console.error('Error loading fresh data:', e); }
	}

	async function handleLogout() {
		const uid = $user?.uid;
		if (uid) {
			localStorage.removeItem(`friends_${uid}`);
			localStorage.removeItem(`user_profile_${uid}`);
		}
		lastLoadedUid = null;
		await signOut(auth);
	}

	$effect(() => {
		const currentUser = $user;
		if (currentUser) {
			untrack(() => { loadAll(); });
		}
	});
</script>

{#if $user}
	<div class="whatsapp-layout">
		{#if Sidebar}
			<Sidebar 
				bind:activeTab 
				bind:selectedFriend 
				bind:searchResults
				bind:searchQuery
				{friendsList} 
				{friendsStatus} 
				{friendRequests}
				{loading}
				{cachedUser}
				onsearch={handleSearchInput}
				onsendrequest={sendRequest}
				onacceptrequest={acceptRequest}
				onopensettings={() => showSettingsModal = true}
			/>
		{/if}

		{#if ChatWindow}
			<ChatWindow 
				{selectedFriend} 
				{friendsStatus} 
			/>
		{/if}
	</div>

	{#if showSettingsModal && SettingsModal}
		<SettingsModal 
			onclose={() => showSettingsModal = false} 
			onlogout={handleLogout} 
		/>
	{/if}
{:else}
	<LandingPage />
{/if}
