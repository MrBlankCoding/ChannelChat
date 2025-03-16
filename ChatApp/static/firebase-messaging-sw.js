importScripts(
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js"
);

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCjJzQGCZ0niMD5tek_0gLSBGJXxW0VLKA",
  authDomain: "channelchat-7d679.firebaseapp.com",
  projectId: "channelchat-7d679",
  storageBucket: "channelchat-7d679.appspot.com",
  messagingSenderId: "822894243205",
  appId: "1:822894243205:web:8c8b1648fece9ae33e68ec",
  measurementId: "G-W4NJ28ZYC6",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log("Received background message:", payload);

  const notificationTitle = payload.notification.title || "New Message";
  const notificationOptions = {
    body: payload.notification.body || "",
    icon: "/img/app-icon.png",
    badge: "/img/notification-badge.png",
    data: payload.data || {},
    tag: payload.data?.room_id || "message", // Group by room
    renotify: true,
  };

  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Get the room ID from the notification data
  const roomId = event.notification.data?.room_id;

  // Navigate to the chat room if available
  if (roomId) {
    const urlToOpen = new URL(`/chat/${roomId}`, self.location.origin).href;

    const promiseChain = clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((windowClients) => {
        // Check if there is already a window/tab open with the target URL
        let matchingClient = null;

        for (let i = 0; i < windowClients.length; i++) {
          const windowClient = windowClients[i];
          if (windowClient.url.includes(roomId)) {
            matchingClient = windowClient;
            break;
          }
        }

        // If a window is already open, focus it
        if (matchingClient) {
          return matchingClient.focus();
        }
        // If no window is open, open a new one
        return clients.openWindow(urlToOpen);
      });

    event.waitUntil(promiseChain);
  }
});
