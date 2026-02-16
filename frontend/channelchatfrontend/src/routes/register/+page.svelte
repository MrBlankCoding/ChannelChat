<script lang="ts">
	import { auth } from '$lib/firebase';
	import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
	import { goto } from '$app/navigation';

	let email = $state('');
	let password = $state('');
	let error = $state('');

	async function handleRegister(e: Event) {
		e.preventDefault();
		error = '';
		try {
			await createUserWithEmailAndPassword(auth, email, password);
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

<h1>Register</h1>

<form onsubmit={handleRegister}>
	<div>
		<label for="email">Email:</label>
		<input type="email" id="email" bind:value={email} autocomplete="email" required />
	</div>
	<div>
		<label for="password">Password:</label>
		<input type="password" id="password" bind:value={password} autocomplete="new-password" required />
	</div>
	<button type="submit">Register</button>
</form>

<hr />

<button onclick={handleGoogleSignIn}>Sign in with Google</button>

{#if error}
	<p style="color: red;">{error}</p>
{/if}

<p>Already have an account? <a href="/login">Login here</a></p>
