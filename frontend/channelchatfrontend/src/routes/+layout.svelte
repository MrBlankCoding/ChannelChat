<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { initAuth, user } from '$lib/auth';
	import { auth } from '$lib/firebase';
	import { onMount } from 'svelte';
	import { signOut } from 'firebase/auth';
	import { goto } from '$app/navigation';
	import '$lib/styles/global_theme.css';

	let { children, data } = $props();

	if (data.user && !$user) {
		user.set(data.user as any);
	}

	onMount(() => {
		initAuth();
	});

	async function handleLogout() {
		await signOut(auth);
		goto('/');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-container">
	{@render children()}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background-color: var(--bg-primary);
		color: var(--text-primary);
		font-family: var(--font-sans);
		height: 100vh;
		overflow: hidden;
	}

	.app-container {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	:global(button) {
		background-color: var(--primary);
		color: var(--bg-primary);
		border: none;
		padding: var(--button-padding);
		border-radius: var(--button-radius);
		font-weight: var(--button-font-weight);
		cursor: pointer;
		transition: var(--transition-all);
	}

	:global(button:hover) {
		filter: brightness(1.1);
	}

	:global(button:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(input) {
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		color: var(--text-primary);
		padding: var(--form-element-padding);
		border-radius: var(--form-element-radius);
		outline: none;
		transition: var(--transition-all);
	}

	:global(input:focus) {
		border-color: var(--border-focus);
		box-shadow: var(--shadow-focus);
	}
</style>
