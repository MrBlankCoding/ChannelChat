<script lang="ts">
	import { auth } from '$lib/firebase';
	import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
	import { goto } from '$app/navigation';

	let email = $state('');
	let password = $state('');
	let error = $state('');

	async function handleLogin(e: Event) {
		e.preventDefault();
		error = '';
		try {
			await signInWithEmailAndPassword(auth, email, password);
			goto('/');
		} catch (err: any) {
			error = err.message;
		}
	}

	async function handleGoogleSignIn() {
		const provider = new GoogleAuthProvider();
		try {
			await signInWithPopup(auth, provider);
			goto('/');
		} catch (err: any) {
			error = err.message;
		}
	}
</script>

<h1>Login</h1>

<form onsubmit={handleLogin}>
	<div>
		<label for="email">Email:</label>
		<input type="email" id="email" bind:value={email} autocomplete="email" required />
	</div>
	<div>
		<label for="password">Password:</label>
		<input type="password" id="password" bind:value={password} autocomplete="current-password" required />
	</div>
	<button type="submit">Login</button>
</form>

<hr />

<button onclick={handleGoogleSignIn}>Sign in with Google</button>

{#if error}
	<p style="color: red;">{error}</p>
{/if}

<p>Don't have an account? <a href="/register">Register here</a></p>
