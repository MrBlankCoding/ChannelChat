import WebSocketManager from "./WebSocketManager.js";
import ChatManager from "./ChatManager.js";
import Sidebar from "./Sidebar.js";
import NotificationManager from "./NotificationManager.js";
import { waitForAuthReady, isAuthenticated } from "./auth.js";
import { initFirebase } from "./firebaseConfig.js";
import UserInviteManager from "./UserInviteManager.js";
import authAxios from "./authAxios.js";
import { initializeOnPageLoad } from "./auth.js";

/**
 * Main application class responsible for coordinating all application components
 */
class App {
  constructor() {
    // Core state
    this.initialized = false;
    this.currentPath = window.location.pathname;
    this.currentRoomId = this.extractRoomIdFromPath(this.currentPath);
    this.isRoomsView = this.currentPath === "/chat";
    this.currentUser = null;

    initializeOnPageLoad();

    // Components
    this.wsManager = window.wsManager || null;
    this.chatManager = null;
    this.sidebar = null;
    this.notificationManager = null;
    this.firebaseApp = null;
    this.userInviteManager = null;

    // Bind methods
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.switchRoom = this.switchRoom.bind(this);
    this.handleSidebarRoomClick = this.handleSidebarRoomClick.bind(this);
    this.handlePopState = this.handlePopState.bind(this);
    this.initializeUserProfileDisplay =
      this.initializeUserProfileDisplay.bind(this);
  }

  /**
   * Extract room ID from URL path
   */
  extractRoomIdFromPath(path) {
    return path.startsWith("/chat/") ? path.split("/").pop() : null;
  }

  /**
   * Fetch current user data
   */
  async fetchCurrentUser() {
    try {
      const response = await authAxios.get("/users/me");
      this.currentUser = response.data;
      return this.currentUser;
    } catch (error) {
      console.error("Failed to fetch current user:", error);
      throw new Error("Failed to fetch user data");
    }
  }

  /**
   * Initialize the application
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Check authentication and redirect if needed
      const isAuthenticated = await waitForAuthReady();
      if (!isAuthenticated) {
        sessionStorage.setItem("redirectUrl", window.location.pathname);
        window.location.href = "/login";
        return;
      }

      await this.initializeComponents();
      this.setupEventListeners();
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize app:", error);
      this.handleInitializationError(error);
    }
  }

  /**
   * Initialize all application components
   */
  async initializeComponents() {
    // Initialize Firebase
    const { app } = await initFirebase();
    this.firebaseApp = app;

    // Fetch current user data
    try {
      await this.fetchCurrentUser();
    } catch (error) {
      throw new Error("Failed to fetch user data");
    }

    // Initialize user profile display
    this.initializeUserProfileDisplay();

    // Initialize NotificationManager
    this.notificationManager = new NotificationManager();
    await this.notificationManager.initialize(this.firebaseApp);

    // Use existing WebSocket manager or create new one
    if (!window.wsManager) {
      window.wsManager = WebSocketManager.getInstance();
    }
    this.wsManager = window.wsManager;
    this.wsManager.setCurrentUser(this.currentUser);

    // Initialize sidebar
    this.sidebar = new Sidebar();
    if (!(await this.sidebar.initialize(this.wsManager, this.currentUser))) {
      throw new Error("Failed to initialize sidebar");
    }
    this.sidebar.onRoomClick(this.handleSidebarRoomClick);

    // Initialize user invite manager
    this.userInviteManager = new UserInviteManager();
    try {
      await this.userInviteManager.initialize();
    } catch (error) {
      console.warn("Failed to initialize user invite manager:", error);
    }

    // Initialize view based on current path
    if (this.currentRoomId) {
      await this.wsManager.connect(this.currentRoomId);
      await this.initializeChat(this.currentRoomId);
      this.userInviteManager?.updateRoomContext(this.currentRoomId);
    } else if (this.isRoomsView) {
      await this.showBaseView();
    }
  }

  /**
   * Initialize the user profile display
   */
  initializeUserProfileDisplay() {
    if (!this.currentUser) {
      console.warn("Cannot initialize user profile display: No user data");
      return;
    }

    const userProfileImage = document.getElementById("userProfileImage");
    const userDisplayName = document.getElementById("userDisplayName");

    if (!userProfileImage || !userDisplayName) {
      console.warn("User profile display elements not found");
      return;
    }

    // Set user display name
    userDisplayName.textContent =
      this.currentUser.username || this.currentUser.name || "User";

    // Try to get profile photo from localStorage first
    const cachedProfilePhoto = localStorage.getItem("cachedProfilePhoto");

    if (cachedProfilePhoto) {
      userProfileImage.src = cachedProfilePhoto;
    } else if (this.currentUser.profilePhotoUrl) {
      // If not in localStorage but in user data, use that and cache it
      userProfileImage.src = this.currentUser.profilePhotoUrl;
      localStorage.setItem(
        "cachedProfilePhoto",
        this.currentUser.profilePhotoUrl
      );
    } else {
      // Fallback to default image
      userProfileImage.src = "/static/images/default-profile.png";
    }

    // Add error handler to fall back to default image if loading fails
    userProfileImage.onerror = function () {
      this.src = "/static/images/default-profile.png";
    };
  }

  /**
   * Show the Base Chat page
   */
  async showBaseView() {
    // Update UI elements
    document.getElementById("messageForm")?.classList.add("hidden");

    const messagesContainer = document.getElementById("messages");
    if (messagesContainer) messagesContainer.innerHTML = "";

    document.getElementById("roomsView")?.classList.remove("hidden");

    // Update state
    this.isRoomsView = true;
    this.currentRoomId = null;

    // Update invite manager
    if (this.userInviteManager) {
      this.userInviteManager.updateRoomContext(null);
      await this.userInviteManager.loadPendingInvites();
    }
  }

  /**
   * Initialize chat for a specific room
   */
  async initializeChat(roomId) {
    try {
      this.showLoadingState();

      // Update UI state
      this.isRoomsView = false;
      document.getElementById("roomsView")?.classList.add("hidden");

      // Ensure WebSocket connection
      if (
        !this.wsManager.isWebSocketOpen() ||
        this.wsManager.currentRoom !== roomId
      ) {
        await this.wsManager.connect(roomId);
      }

      // Initialize chat manager
      this.chatManager = new ChatManager();
      this.chatManager.roomId = roomId;
      this.chatManager.currentUser = this.currentUser;
      if (!(await this.chatManager.initialize(this.wsManager))) {
        throw new Error("Failed to initialize chat manager");
      }

      this.currentRoomId = roomId;
      document.getElementById("messageForm")?.classList.remove("hidden");
      this.hideLoadingState();
      return true;
    } catch (error) {
      console.error(`Failed to initialize chat for room ${roomId}:`, error);
      this.showErrorMessage("Failed to initialize chat. Please try again.");
      this.hideLoadingState();
      return false;
    }
  }

  /**
   * Handle click event from sidebar room
   */
  async handleSidebarRoomClick(roomId) {
    if (roomId === this.currentRoomId) return;

    // Update URL and state
    const newUrl = `/chat/${roomId}`;
    window.history.pushState({ roomId }, "", newUrl);
    this.currentPath = newUrl;
    this.isRoomsView = false;

    this.userInviteManager?.updateRoomContext(roomId);
    await this.switchRoom(roomId);
  }

  /**
   * Switch to a different chat room
   */
  async switchRoom(roomId) {
    console.log(`Switching to room: ${roomId}`);
    this.showLoadingState();

    // Clear messages
    if (this.chatManager?.chatUI) {
      this.chatManager.chatUI.clearMessages();
    } else {
      const messagesContainer = document.getElementById("messages");
      if (messagesContainer) messagesContainer.innerHTML = "";
    }

    // Initialize new room
    const success = await this.initializeChat(roomId);
    if (!success) {
      this.showErrorMessage(
        "Failed to switch to the selected room. Please try again."
      );
    }

    return success;
  }

  /**
   * UI Helper Methods
   */
  showLoadingState() {
    if (this.chatManager?.chatUI) {
      this.chatManager.chatUI.setLoading(true);
    } else {
      document.getElementById("loadingSpinner")?.classList.remove("hidden");
    }
  }

  hideLoadingState() {
    if (this.chatManager?.chatUI) {
      this.chatManager.chatUI.setLoading(false);
    } else {
      document.getElementById("loadingSpinner")?.classList.add("hidden");
    }
  }

  showErrorMessage(message) {
    if (this.chatManager?.chatUI) {
      this.chatManager.chatUI.showError(message);
    } else {
      const messagesContainer = document.getElementById("messages");
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="p-4 text-red-500 text-center">${message}</div>
        `;
      }
    }
  }

  /**
   * Set up all event listeners
   */
  setupEventListeners() {
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    window.addEventListener("popstate", this.handlePopState);

    // Setup notification permission button
    const notificationToggle = document.getElementById("notificationToggle");
    if (notificationToggle && this.notificationManager) {
      notificationToggle.addEventListener("click", async () => {
        await this.notificationManager.requestPermission();
        this.updateNotificationPermissionButton();
      });
      this.updateNotificationPermissionButton();
    }
  }

  /**
   * Handle browser back/forward navigation
   */
  async handlePopState(event) {
    const newPath = window.location.pathname;
    this.currentPath = newPath;
    const roomId = this.extractRoomIdFromPath(newPath);

    if (roomId) {
      await this.switchRoom(roomId);
    } else if (newPath === "/chat") {
      if (this.chatManager) {
        this.chatManager.cleanup();
        this.chatManager = null;
      }
      this.currentRoomId = null;
      await this.showBaseView();
    }
  }

  /**
   * Update notification permission button UI
   */
  updateNotificationPermissionButton() {
    if (!this.notificationManager) return;

    const btn = document.getElementById("notificationToggle");
    if (!btn) return;

    const status = this.notificationManager.getPermissionStatus();
    btn.classList.remove("disabled", "enabled");

    if (status === "granted") {
      btn.classList.add("enabled");
    } else if (status === "denied") {
      btn.classList.add("disabled");
    }
  }

  /**
   * Handle document visibility changes (tab focus/unfocus)
   */
  handleVisibilityChange() {
    const isVisible = !document.hidden;

    // Update WebSocket connection if needed
    if (
      isVisible &&
      isAuthenticated() &&
      this.wsManager &&
      !this.wsManager.isWebSocketOpen()
    ) {
      this.wsManager.connect().then(() => {
        if (this.currentRoomId) {
          this.wsManager.switchRoom(this.currentRoomId);
        }
      });
    }

    // Notify components
    this.chatManager?.handleVisibilityChange(isVisible);
    this.sidebar?.handleVisibilityChange(isVisible);
  }

  /**
   * Handle page unload event
   */
  handleBeforeUnload() {
    this.cleanup();
  }

  /**
   * Handle initialization errors
   */
  handleInitializationError(error) {
    this.cleanup();

    console.error("Initialization error:", {
      message: error.message,
      stack: error.stack,
      components: {
        wsManager: !!this.wsManager,
        sidebar: !!this.sidebar,
        chatManager: !!this.chatManager,
      },
    });

    // Show error message to user
    const errorMessage =
      "Failed to initialize application. Please refresh the page.";
    const existingBanner = document.querySelector(".error-banner");

    if (existingBanner) {
      existingBanner.textContent = errorMessage;
    } else {
      const banner = document.createElement("div");
      banner.className =
        "error-banner bg-red-500 text-white p-4 text-center font-bold";
      banner.textContent = errorMessage;
      document.body.prepend(banner);
    }
  }

  /**
   * Clean up resources and event listeners
   */
  cleanup() {
    // Remove event listeners
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    window.removeEventListener("popstate", this.handlePopState);

    // Clean up components
    [
      this.chatManager,
      this.sidebar,
      this.userInviteManager,
      this.notificationManager,
    ].forEach((component) => {
      if (component?.cleanup) {
        component.cleanup();
      }
    });

    this.chatManager = null;
    this.sidebar = null;
    this.userInviteManager = null;
    this.notificationManager = null;
    this.initialized = false;
  }
}

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
  window.app.initialize().catch((error) => {
    console.error("Failed to initialize app:", error);
  });
});

export default App;
