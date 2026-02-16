import { auth } from './firebase';
import { PUBLIC_BACKEND_URL } from '$env/static/public';

const BACKEND_URL = PUBLIC_BACKEND_URL || 'http://localhost:8080';

// sleepppppppppp
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchWithAuth(path: string, options: RequestInit = {}, retries = 3) {
    let token: string | null = null;

    for (let i = 0; i < retries; i++) {
        // 1. Try to get token from Firebase SDK
        const user = auth.currentUser;
        if (user) {
            token = await user.getIdToken();
            break;
        } 
        
        // 2. Fallback: Try to get token from the session cookie
        const match = document.cookie.match(/session=([^;]+)/);
        token = match ? match[1] : null;
        
        if (token) break;

        // If no token yet, wait a bit for SDK to initialize
        if (i < retries - 1) {
            await sleep(500);
        }
    }

    if (!token) {
        console.warn('No auth token found after retries for:', path);
        throw new Error('User not authenticated');
    }

    try {
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${token}`);

        const response = await fetch(`${BACKEND_URL}${path}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Backend error (${response.status}):`, errorText);
            throw new Error(errorText || `Request failed with status ${response.status}`);
        }

        return response.json();
    } catch (e) {
        console.error('Error in fetchWithAuth:', e);
        throw e;
    }
}
