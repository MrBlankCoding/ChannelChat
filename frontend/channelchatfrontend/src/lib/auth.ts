import { writable } from 'svelte/store';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { initPresence } from './presence';

export const user = writable<User | null>(null);

let initialLoad = true;

export const initAuth = () => {
    onAuthStateChanged(auth, async (u) => {
        if (u) {
            initPresence(u);
        }
        
        // If we have a user from the SDK, or if this isn't the first check, 
        // or if we explicitly don't have a hydrated user, update the store.
        if (u || !initialLoad) {
            user.set(u);
        }
        initialLoad = false;
        if (u) {
            const token = await u.getIdToken();
            document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Lax;`;
        } else if (!initialLoad) {
            // Only clear cookie if it's a real logout (not initial loading state)
            document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax;';
        }
    });
};
