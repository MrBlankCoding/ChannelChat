importScripts(
  "https://www.gstatic.com/firebasejs/11.2.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.2.0/firebase-messaging-compat.js"
);

// Initialize Firebase
firebase.initializeApp({
  apiKey: "AIzaSyCjJzQGCZ0niMD5tek_0gLSBGJXxW0VLKA",
  authDomain: "channelchat-7d679.firebaseapp.com",
  projectId: "channelchat-7d679",
  storageBucket: "channelchat-7d679.appspot.com",
  messagingSenderId: "822894243205",
  appId: "1:822894243205:web:8c8b1648fece9ae33e68ec",
  measurementId: "G-W4NJ28ZYC6",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);

  // Extract notification details
  const notificationTitle = payload.notification?.title || "New Message";
  const notificationBody = payload.notification?.body || "";

  const notificationOptions = {
    body: notificationBody,
    icon: "/static/images/chat-icons.png", // Update with your actual path
    badge: "/img/chat-icons.png", // Update with your actual path
    tag: "chat-notification",
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log("Notification clicked:", event);

  const roomId = event.notification.data?.room_id;

  // Close all notifications
  event.notification.close();

  // Navigate to the appropriate chat room
  if (roomId) {
    const url = `/chat/${roomId}`;

    // Focus on existing tab if already open
    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true,
        })
        .then((clientList) => {
          for (const client of clientList) {
            if (client.url.includes(roomId) && "focus" in client) {
              return client.focus();
            }
          }

          // Open new window if no matching tab found
          if (clients.openWindow) {
            return clients.openWindow(url);
          }
        })
    );
  }
});
