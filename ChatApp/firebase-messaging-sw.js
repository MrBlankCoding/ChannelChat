importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
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

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/static/images/chat-icon.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Create a specific cache for profile photos
const PROFILE_CACHE = 'profile-photos';

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

// Special handling for profile photos
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

// General image caching (excluding profile photos)
workbox.routing.registerRoute(
  ({request, url}) => request.destination === 'image' && !url.pathname.includes('profile_'),
  new workbox.strategies.CacheFirst({
    cacheName: 'images',
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Cache CSS and JavaScript files
workbox.routing.registerRoute(
  ({request}) => request.destination === 'style' || request.destination === 'script',
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'static-resources',
  })
);

// Cache the Google Fonts stylesheets with a stale-while-revalidate strategy.
workbox.routing.registerRoute(
  ({url}) => url.origin === 'https://fonts.googleapis.com',
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'google-fonts-stylesheets',
  })
);

// Cache the underlying font files with a cache-first strategy for 1 year.
workbox.routing.registerRoute(
  ({url}) => url.origin === 'https://fonts.gstatic.com',
  new workbox.strategies.CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        maxEntries: 30,
      }),
    ],
  })
);

// Offline fallback
const offlineFallbackPage = '/static/fallback.html';

// Cache the offline page on install
self.addEventListener('install', async (event) => {
  event.waitUntil(
    caches.open(workbox.core.cacheNames.offline)
      .then((cache) => cache.add(offlineFallbackPage))
  );
});

// Serve offline page for navigation requests that fail
workbox.routing.setCatchHandler(async ({event}) => {
  if (event.request.destination === 'document') {
    return caches.match(offlineFallbackPage);
  }
  return Response.error();
});

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