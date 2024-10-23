importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

// Your Firebase configuration
firebase.initializeApp({
  apiKey: "AIzaSyCjJzQGCZ0niMD5tek_0gLSBGJXxW0VLKA",
  authDomain: "channelchat-7d679.firebaseapp.com",
  projectId: "channelchat-7d679",
  storageBucket: "channelchat-7d679.appspot.com",
  messagingSenderId: "822894243205",
  appId: "1:822894243205:web:e129bcac94601e183e68ec",
  measurementId: "G-PL15EEFQDE"
});

// Create caches for profile photos and sent images
const PROFILE_CACHE = 'profile-photos';
const USER_SENT_IMAGES_CACHE = 'user-sent-images';

// Custom plugin to handle profile photo cache cleanup
const profilePhotoCachePlugin = {
  cacheDidUpdate: async ({cacheName, request, oldResponse, newResponse}) => {
    if (cacheName === PROFILE_CACHE && oldResponse) {
      const cache = await caches.open(PROFILE_CACHE);
      const keys = await cache.keys();
      const oldProfileUrl = request.url.split('?')[0]; // Remove cache busting parameter
      
      // Find and remove old versions of this user's profile photo
      for (const key of keys) {
        const keyUrl = key.url.split('?')[0];
        if (keyUrl === oldProfileUrl && key.url !== request.url) {
          await cache.delete(key);
        }
      }
    }
  }
};

// Cache profile photos
workbox.routing.registerRoute(
  ({url}) => url.pathname.includes('profile_'),
  new workbox.strategies.CacheFirst({
    cacheName: PROFILE_CACHE,
    plugins: [
      profilePhotoCachePlugin,
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Cache user-sent images (assuming they are stored under a specific path, e.g., /user-images/)
workbox.routing.registerRoute(
  ({url}) => url.pathname.includes('/user-images/'),
  new workbox.strategies.CacheFirst({
    cacheName: USER_SENT_IMAGES_CACHE,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 100, // Adjust as needed
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Periodic sync for background updates (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-cache') {
    event.waitUntil(updateCache());
  }
});

async function updateCache() {
  // Add logic here to update your cache
  console.log('Updating cache in the background');
}
