
    // Based off of https://github.com/pwa-builder/PWABuilder/blob/main/docs/sw.js

    /*
      Welcome to our basic Service Worker! This Service Worker offers a basic offline experience
      while also being easily customizeable. You can add in your own code to implement the capabilities
      listed below, or change anything else you would like.


      Need an introduction to Service Workers? Check our docs here: https://docs.pwabuilder.com/#/home/sw-intro
      Want to learn more about how our Service Worker generation works? Check our docs here: https://docs.pwabuilder.com/#/studio/existing-app?id=add-a-service-worker

      Did you know that Service Workers offer many more capabilities than just offline? 
        - Background Sync: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/06
        - Periodic Background Sync: https://web.dev/periodic-background-sync/
        - Push Notifications: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=push-notifications-on-the-web
        - Badges: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=application-badges
    */
// Improved Service Worker with advanced caching strategies

import { precacheAndRoute } from 'workbox-precaching/precacheAndRoute';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Precache critical assets during installation
precacheAndRoute([
  { revision: "8838ac251462a5da2cd1dc0a136ee953", url: "css/output.css" },
  { revision: "6d2fb01e78764429d1a0709f2cfb8bdf", url: "js/app.js" },
  { revision: "f78a23224bfe57ff407d114f0f3f8409", url: "js/WebSocketManager.js" },
  { revision: "d7a98605bd12a6599cfe620d1313d44f", url: "js/ChatUI.js" },
  { revision: "b7d0bee57520ce77e78cb7a3de118dbe", url: "js/ImageGallery.js" },
  { revision: "532b79788b3322084f42c77117679eed", url: "js/MessageRenderer.js" },
  { revision: "344421946926b46307faca78fcc82bea", url: "js/firebaseConfig.js" },
  { revision: "60052eaa1ab0dc04d4b9f67e22a61f0c", url: "js/login.js" },
  { revision: "1eb5cfd5db200b145e3449d266fcc269", url: "js/Sidebar.js" },
  { revision: "6f081820979adf411c18182d0dd315d2", url: "js/UserInviteManager.js" },
  { revision: "570633c0afc9fe4bb88f9a4bb3ea2a14", url: "js/NotificationManager.js" },
  { revision: "5874c8325bf2b7e3a1c1fea2f98f7504", url: "js/authAxios.js" },
  { revision: "733bb88f5f335bb388ddd965d0849399", url: "js/settings.js" },
  { revision: "e6326418dd72f2a2994f248bc0624a0b", url: "service-worker.js" },
  { revision: "c10d9fdb3a38d644931cb72d1b409646", url: "firebase-messaging-sw.js" },
  { revision: "d41d8cd98f00b204e9800998ecf8427e", url: "static/manifest.json" },
  { revision: "f1a2d3c4567890abcd123ef56789abc1", url: "static/images/manifest-icon-192.maskable.png" },
  { revision: "9b86498703051c128fc278c91058a75a", url: "static/images/default-profile.png" }
]);

// Cache CSS and JavaScript files with a Stale While Revalidate strategy
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Cache images with a Cache First strategy
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Cache font files
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'fonts',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 24 * 60 * 60, // 60 days
      }),
    ],
  })
);

// Use Network First for API requests (with fallback to cached responses)
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') || 
               url.pathname.startsWith('/rooms/') || 
               url.pathname.startsWith('/messages/') ||
               url.pathname.startsWith('/users/'),
  new NetworkFirst({
    cacheName: 'api-responses',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes
      }),
    ],
  })
);

// Cache the HTML pages using StaleWhileRevalidate
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new StaleWhileRevalidate({
    cacheName: 'pages',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

// Special handling for firebase config
registerRoute(
  ({ url }) => url.pathname.includes('firebase-config'),
  new NetworkFirst({
    cacheName: 'firebase-config',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 5,
        maxAgeSeconds: 60 * 60, // 1 hour
      }),
    ],
  })
);