import authAxios from "./authAxios.js";
class NotificationManager {
  constructor() {
    // Singleton pattern
    if (NotificationManager.instance) return NotificationManager.instance;
    NotificationManager.instance = this;

    // Core state
    this.initialized = false;
    this.messaging = null;
    this.currentToken = null;
    this.fcmPublicVapidKey =
      "BFF7GvyyBdEKRjSCNeDKIB0U85iGp7-wUm-mtV7GmBgq5FHqsQmcxTWe9QElWuwhdZEZ6xhGMcCRSreeAq-XSlE";
    this.deviceId = this.generateDeviceId();
    this.notificationPermissionStatus = null;
    this.onMessageCallbacks = [];
    this.firebase = null;

    // Bind methods
    this.handleTokenRefresh = this.handleTokenRefresh.bind(this);
    this.handleForegroundMessage = this.handleForegroundMessage.bind(this);
  }

  async initialize(firebaseInstance) {
    if (this.initialized) return true;

    try {
      console.log("Initializing NotificationManager...");

      // Log full structure of the firebase instance to debug
      console.log(
        "Full Firebase instance structure:",
        JSON.stringify(Object.keys(firebaseInstance))
      );

      // The issue is here - firebaseInstance is the app, not the return object from initFirebase
      // We need to import messaging directly since it's not available on the app

      const { getMessaging, getToken, onMessage } = await import(
        "https://www.gstatic.com/firebasejs/11.2.0/firebase-messaging.js"
      );

      // Initialize messaging with the app instance
      this.messaging = getMessaging(firebaseInstance);

      console.log("Messaging initialized directly:", this.messaging);

      if (!this.messaging) {
        console.error("Messaging failed to initialize.");
        return false;
      }

      // Set up token refresh handler and message handler
      onMessage(this.messaging, this.handleForegroundMessage);

      this.notificationPermissionStatus = Notification.permission;
      this.initialized = true;
      console.log("NotificationManager initialized successfully.");

      if (this.notificationPermissionStatus === "granted") {
        try {
          const currentToken = await getToken(this.messaging, {
            vapidKey: this.fcmPublicVapidKey,
          });

          if (currentToken) {
            this.currentToken = currentToken;
            localStorage.setItem("fcmToken", currentToken);
            await this.registerTokenWithBackend(currentToken);
          }
        } catch (tokenError) {
          console.error("Error getting token:", tokenError);
        }
      }

      return true;
    } catch (error) {
      console.error(
        "Failed to initialize NotificationManager:",
        error,
        error.stack
      );
      return false;
    }
  }

  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();
      this.notificationPermissionStatus = permission;

      if (permission === "granted") {
        console.log("Notification permission granted");
        await this.getAndRegisterToken();
        return true;
      } else {
        console.log("Notification permission denied");
        return false;
      }
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      return false;
    }
  }

  async getAndRegisterToken() {
    try {
      if (!this.messaging) {
        console.error("Messaging not initialized");
        return null;
      }

      // Import getToken function directly
      const { getToken } = await import(
        "https://www.gstatic.com/firebasejs/11.2.0/firebase-messaging.js"
      );

      // Get FCM token
      const currentToken = await getToken(this.messaging, {
        vapidKey: this.fcmPublicVapidKey,
      });

      if (!currentToken) {
        console.log("No FCM token available");
        return null;
      }

      // Save token locally
      this.currentToken = currentToken;
      localStorage.setItem("fcmToken", currentToken);

      // Register token with backend
      await this.registerTokenWithBackend(currentToken);

      return currentToken;
    } catch (error) {
      console.error("Error getting or registering FCM token:", error);
      return null;
    }
  }

  async registerTokenWithBackend(token) {
    try {
      const deviceType = this.getDeviceType();

      await authAxios.post("/users/fcm-tokens", {
        token: token,
        device_id: this.deviceId,
        device_type: deviceType,
      });

      console.log("FCM token registered with backend");
      return true;
    } catch (error) {
      console.error("Error registering FCM token with backend:", error);
      return false;
    }
  }

  async deleteToken() {
    try {
      if (!this.currentToken) return true;

      // Delete from backend
      await authAxios.delete(`/users/fcm-tokens/${this.currentToken}`);

      // Clear local token
      this.currentToken = null;
      localStorage.removeItem("fcmToken");

      console.log("FCM token deleted");
      return true;
    } catch (error) {
      console.error("Error deleting FCM token:", error);
      return false;
    }
  }

  handleTokenRefresh(newToken) {
    console.log("FCM token refreshed");
    this.currentToken = newToken;
    this.registerTokenWithBackend(newToken);
  }

  handleForegroundMessage(payload) {
    console.log("Foreground message received:", payload);

    try {
      // Create notification options
      const notificationTitle = payload.notification?.title || "New Message";
      const notificationOptions = {
        body: payload.notification?.body || "",
        icon: "/img/app-icon.png", // Replace with your app icon
        badge: "/img/notification-badge.png", // Replace with your badge icon
        data: payload.data || {},
      };

      // Handle foreground notification
      this.showNotification(notificationTitle, notificationOptions);

      // Trigger callbacks
      this.onMessageCallbacks.forEach((callback) => {
        try {
          callback(payload);
        } catch (e) {
          console.error("Error in notification callback:", e);
        }
      });
    } catch (error) {
      console.error("Error handling foreground message:", error);
    }
  }

  showNotification(title, options) {
    // Don't show notification if tab is active and notification sound is disabled
    if (
      document.visibilityState === "visible" &&
      localStorage.getItem("notificationSound") !== "true"
    ) {
      return;
    }

    // Play notification sound if enabled
    if (localStorage.getItem("notificationSound") === "true") {
      this.playNotificationSound();
    }

    // Show notification if permission granted
    if (Notification.permission === "granted") {
      return new Notification(title, options);
    }
  }

  playNotificationSound() {
    try {
      const audio = new Audio("/sounds/notification.mp3"); // Replace with your sound file
      audio
        .play()
        .catch((e) => console.log("Error playing notification sound:", e));
    } catch (error) {
      console.error("Error playing notification sound:", error);
    }
  }

  onMessage(callback) {
    if (typeof callback === "function") {
      this.onMessageCallbacks.push(callback);
    }
  }

  generateDeviceId() {
    // Try to get existing device ID from local storage
    let deviceId = localStorage.getItem("deviceId");

    if (!deviceId) {
      // Generate a simple UUID for device ID
      deviceId =
        "device_" +
        Date.now() +
        "_" +
        Math.random().toString(36).substring(2, 15);
      localStorage.setItem("deviceId", deviceId);
    }

    return deviceId;
  }

  getDeviceType() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    // Check for mobile devices
    if (/android/i.test(userAgent)) {
      return "android";
    }

    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      return "ios";
    }

    return "web";
  }

  getPermissionStatus() {
    return this.notificationPermissionStatus;
  }

  isSupported() {
    return "Notification" in window && this.messaging !== null;
  }
}

export default NotificationManager;
