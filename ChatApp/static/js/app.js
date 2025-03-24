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
    this.state = {
      initialized: false,
      currentPath: window.location.pathname,
      isRoomsView: window.location.pathname === "/chat",
      currentUser: null,
      components: {
        wsManager: window.wsManager || null,
        chatManager: null,
        sidebar: null,
        notificationManager: null,
        firebaseApp: null,
        userInviteManager: null
      }
    };
    
    this.state.currentRoomId = this.extractRoomIdFromPath(this.state.currentPath);

    // Initialize auth early
    initializeOnPageLoad();

    // Bind methods
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.switchRoom = this.switchRoom.bind(this);
    this.handleSidebarRoomClick = this.handleSidebarRoomClick.bind(this);
    this.handlePopState = this.handlePopState.bind(this);
    this.initializeUserProfileDisplay = this.initializeUserProfileDisplay.bind(this);
  }

  /**
   * Extract room ID from URL path
   */
  extractRoomIdFromPath(path) {
    return path.startsWith("/chat/") ? path.split("/").pop() : null;
  }

  /**
   * Fetch current user data with caching
   */
  async fetchCurrentUser() {
    try {
      // Check for cached user data first (with short TTL)
      const cachedUser = this.getCachedUser();
      if (cachedUser) {
        this.state.currentUser = cachedUser;
        return cachedUser;
      }

      const response = await authAxios.get("/users/me");
      this.state.currentUser = response.data;
      
      // Cache user data with TTL
      this.cacheUserData(response.data);
      
      return this.state.currentUser;
    } catch (error) {
      console.error("Failed to fetch current user:", error);
      throw new Error("Failed to fetch user data");
    }
  }

  /**
   * Cache user data with TTL
   */
  cacheUserData(userData) {
    const cachedData = {
      user: userData,
      timestamp: Date.now()
    };
    sessionStorage.setItem("cachedUserData", JSON.stringify(cachedData));
  }

  /**
   * Get cached user if still valid (5 minute TTL)
   */
  getCachedUser() {
    try {
      const cachedData = JSON.parse(sessionStorage.getItem("cachedUserData"));
      if (!cachedData) return null;
      
      // 5 minute TTL
      const isExpired = Date.now() - cachedData.timestamp > 5 * 60 * 1000;
      return isExpired ? null : cachedData.user;
    } catch (error) {
      return null;
    }
  }

  /**
   * Initialize the application
   */
  async initialize() {
    if (this.state.initialized) return;

    try {
      // Check authentication and redirect if needed
      const authenticated = await waitForAuthReady();
      if (!authenticated) {
        sessionStorage.setItem("redirectUrl", window.location.pathname);
        window.location.href = "/login";
        return;
      }

      await this.initializeComponents();
      this.setupEventListeners();
      this.state.initialized = true;
      
      // Log successful initialization
      console.log("App initialized successfully");
    } catch (error) {
      console.error("Failed to initialize app:", error);
      this.handleInitializationError(error);
    }
  }

  /**
   * Initialize all application components with improved parallelization
   */
  async initializeComponents() {
    try {
      // Initialize critical components in parallel
      const [firebaseInitResult, userData] = await Promise.all([
        this.initializeFirebase(),
        this.fetchCurrentUser(),
        this.initializeWebSocketManager()
      ]);
      
      this.state.components.firebaseApp = firebaseInitResult;
      
      // Initialize UI components
      this.initializeUserProfileDisplay();
      
      // Initialize remaining components
      await Promise.all([
        this.initializeNotificationManager(),
        this.initializeSidebar(),
        this.initializeUserInviteManager()
      ]);
      
      // Initialize view based on current path
      if (this.state.currentRoomId) {
        await this.state.components.wsManager.connect(this.state.currentRoomId);
        await this.initializeChat(this.state.currentRoomId);
        this.state.components.userInviteManager?.updateRoomContext(this.state.currentRoomId);
      } else if (this.state.isRoomsView) {
        await this.showBaseView();
      }
    } catch (error) {
      console.error("Component initialization failed:", error);
      throw new Error(`Failed to initialize components: ${error.message}`);
    }
  }

  /**
   * Initialize Firebase
   */
  async initializeFirebase() {
    try {
      const { app } = await initFirebase();
      return app;
    } catch (error) {
      console.error("Firebase initialization failed:", error);
      throw new Error("Failed to initialize Firebase");
    }
  }

  /**
   * Initialize WebSocket Manager
   */
  async initializeWebSocketManager() {
    if (!window.wsManager) {
      window.wsManager = WebSocketManager.getInstance();
    }
    this.state.components.wsManager = window.wsManager;
    
    // Set current user when available
    if (this.state.currentUser) {
      this.state.components.wsManager.setCurrentUser(this.state.currentUser);
    }
  }

  /**
   * Initialize Notification Manager
   */
  async initializeNotificationManager() {
    try {
      this.state.components.notificationManager = new NotificationManager();
      await this.state.components.notificationManager.initialize(this.state.components.firebaseApp);
      this.updateNotificationPermissionButton();
    } catch (error) {
      console.warn("Notification manager initialization failed:", error);
      // Non-critical, can continue without notifications
    }
  }

  /**
   * Initialize Sidebar
   */
  async initializeSidebar() {
    try {
      this.state.components.sidebar = new Sidebar();
      const success = await this.state.components.sidebar.initialize(
        this.state.components.wsManager, 
        this.state.currentUser
      );
      
      if (!success) {
        throw new Error("Sidebar initialization returned false");
      }
      
      this.state.components.sidebar.onRoomClick(this.handleSidebarRoomClick);
    } catch (error) {
      console.error("Sidebar initialization failed:", error);
      throw new Error("Failed to initialize sidebar");
    }
  }

  /**
   * Initialize User Invite Manager
   */
  async initializeUserInviteManager() {
    try {
      this.state.components.userInviteManager = new UserInviteManager();
      await this.state.components.userInviteManager.initialize();
      
      if (this.state.currentRoomId) {
        this.state.components.userInviteManager.updateRoomContext(this.state.currentRoomId);
      }
    } catch (error) {
      console.warn("User invite manager initialization failed:", error);
      // Non-critical, can continue without invite management
    }
  }

  /**
   * Initialize the user profile display with better error handling
   */
  initializeUserProfileDisplay() {
    if (!this.state.currentUser) {
      console.warn("Cannot initialize user profile display: No user data");
      return;
    }

    const userProfileImage = document.getElementById("userProfileImage");
    const userDisplayName = document.getElementById("userDisplayName");

    if (!userProfileImage || !userDisplayName) {
      console.warn("User profile display elements not found");
      return;
    }

    // Set user display name with fallbacks
    userDisplayName.textContent = 
      this.state.currentUser.username || 
      this.state.currentUser.name || 
      this.state.currentUser.email || 
      "User";

    // Try to get profile photo with better caching strategy
    this.setUserProfileImage(userProfileImage);
  }

  /**
   * Set user profile image with caching and fallbacks
   */
  setUserProfileImage(imgElement) {
    // Try to get profile photo from localStorage first
    const cachedProfilePhoto = localStorage.getItem("cachedProfilePhoto");
    const cachedTimestamp = parseInt(localStorage.getItem("cachedProfilePhotoTimestamp") || "0");
    const cacheExpired = Date.now() - cachedTimestamp > 24 * 60 * 60 * 1000; // 24 hours
    
    if (cachedProfilePhoto && !cacheExpired) {
      imgElement.src = cachedProfilePhoto;
    } else if (this.state.currentUser.profilePhotoUrl) {
      // If not in localStorage but in user data, use that and cache it
      imgElement.src = this.state.currentUser.profilePhotoUrl;
      localStorage.setItem("cachedProfilePhoto", this.state.currentUser.profilePhotoUrl);
      localStorage.setItem("cachedProfilePhotoTimestamp", Date.now().toString());
    } else {
      // Fallback to default image
      imgElement.src = "/static/images/default-profile.png";
    }

    // Add error handler to fall back to default image if loading fails
    imgElement.onerror = function() {
      this.src = "/static/images/default-profile.png";
      // Clear cache if image URL is invalid
      if (this.src !== "/static/images/default-profile.png") {
        localStorage.removeItem("cachedProfilePhoto");
        localStorage.removeItem("cachedProfilePhotoTimestamp");
      }
    };
  }

  /**
   * Show the Base Chat page
   */
  async showBaseView() {
    // Update UI elements
    document.getElementById("messageForm")?.classList.add("hidden");

    const messagesContainer = document.getElementById("messages");
    if (messagesContainer) {
      messagesContainer.innerHTML = "";
    }

    document.getElementById("roomsView")?.classList.remove("hidden");

    // Update state
    this.state.isRoomsView = true;
    this.state.currentRoomId = null;

    // Update URL if needed without causing navigation event
    if (window.location.pathname !== "/chat") {
      window.history.replaceState(null, "", "/chat");
    }

    // Update invite manager
    if (this.state.components.userInviteManager) {
      this.state.components.userInviteManager.updateRoomContext(null);
      await this.state.components.userInviteManager.loadPendingInvites();
    }
  }

  /**
   * Initialize chat for a specific room with improved error handling and performance
   */
  async initializeChat(roomId) {
    try {
      if (!roomId) {
        throw new Error("Room ID is required");
      }
      
      this.showLoadingState();

      // Update UI state
      this.state.isRoomsView = false;
      document.getElementById("roomsView")?.classList.add("hidden");

      // Ensure WebSocket connection with proper error handling
      if (
        !this.state.components.wsManager.isWebSocketOpen() ||
        this.state.components.wsManager.currentRoom !== roomId
      ) {
        try {
          await this.state.components.wsManager.connect(roomId);
        } catch (wsError) {
          console.error("WebSocket connection failed:", wsError);
          throw new Error("Failed to connect to chat server");
        }
      }

      // Clean up existing chat manager if it exists
      if (this.state.components.chatManager) {
        this.state.components.chatManager.cleanup();
      }

      // Initialize chat manager
      this.state.components.chatManager = new ChatManager();
      this.state.components.chatManager.roomId = roomId;
      this.state.components.chatManager.currentUser = this.state.currentUser;
      
      const chatInitialized = await this.state.components.chatManager.initialize(
        this.state.components.wsManager
      );
      
      if (!chatInitialized) {
        throw new Error("Chat manager initialization returned false");
      }

      this.state.currentRoomId = roomId;
      document.getElementById("messageForm")?.classList.remove("hidden");
      this.hideLoadingState();
      
      return true;
    } catch (error) {
      console.error(`Failed to initialize chat for room ${roomId}:`, error);
      this.showErrorMessage(`Failed to initialize chat: ${error.message}`);
      this.hideLoadingState();
      return false;
    }
  }

  /**
   * Handle click event from sidebar room
   */
  async handleSidebarRoomClick(roomId) {
    if (roomId === this.state.currentRoomId) return;

    // Debounce rapid clicks
    if (this._lastRoomClick && Date.now() - this._lastRoomClick < 500) {
      return;
    }
    this._lastRoomClick = Date.now();

    // Update URL and state
    const newUrl = `/chat/${roomId}`;
    window.history.pushState({ roomId }, "", newUrl);
    this.state.currentPath = newUrl;
    this.state.isRoomsView = false;

    this.state.components.userInviteManager?.updateRoomContext(roomId);
    await this.switchRoom(roomId);
  }

  /**
   * Switch to a different chat room with optimizations
   */
  async switchRoom(roomId) {
    console.log(`Switching to room: ${roomId}`);
    this.showLoadingState();

    // Clear messages
    if (this.state.components.chatManager?.chatUI) {
      this.state.components.chatManager.chatUI.clearMessages();
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
   * UI Helper Methods with animation improvements
   */
  showLoadingState() {
    if (this.state.components.chatManager?.chatUI) {
      this.state.components.chatManager.chatUI.setLoading(true);
    } else {
      const spinner = document.getElementById("loadingSpinner");
      if (spinner) {
        spinner.classList.remove("hidden");
        // Add animation if not already present
        if (!spinner.classList.contains("animate-spin")) {
          spinner.classList.add("animate-spin");
        }
      }
    }
  }

  hideLoadingState() {
    if (this.state.components.chatManager?.chatUI) {
      this.state.components.chatManager.chatUI.setLoading(false);
    } else {
      const spinner = document.getElementById("loadingSpinner");
      if (spinner) {
        spinner.classList.add("hidden");
        spinner.classList.remove("animate-spin");
      }
    }
  }

  showErrorMessage(message) {
    if (this.state.components.chatManager?.chatUI) {
      this.state.components.chatManager.chatUI.showError(message);
    } else {
      const messagesContainer = document.getElementById("messages");
      if (messagesContainer) {
        const errorDiv = document.createElement("div");
        errorDiv.className = "p-4 text-red-500 text-center error-message";
        errorDiv.innerHTML = message;
        
        // Clear existing errors
        const existingErrors = messagesContainer.querySelectorAll(".error-message");
        existingErrors.forEach(el => el.remove());
        
        messagesContainer.innerHTML = "";
        messagesContainer.appendChild(errorDiv);
      }
    }
  }

  /**
   * Set up all event listeners with better performance
   */
  setupEventListeners() {
    // Use passive listeners where applicable for better performance
    document.addEventListener("visibilitychange", this.handleVisibilityChange, { passive: true });
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    window.addEventListener("popstate", this.handlePopState);

    // Setup notification permission button
    this.setupNotificationToggle();
    
    // Add network status handling
    this.setupNetworkStatusHandling();
  }
  
  /**
   * Setup notification toggle button
   */
  setupNotificationToggle() {
    const notificationToggle = document.getElementById("notificationToggle");
    if (notificationToggle && this.state.components.notificationManager) {
      notificationToggle.addEventListener("click", async () => {
        await this.state.components.notificationManager.requestPermission();
        this.updateNotificationPermissionButton();
      });
      this.updateNotificationPermissionButton();
    }
  }
  
  /**
   * Setup network status monitoring
   */
  setupNetworkStatusHandling() {
    window.addEventListener("online", this.handleNetworkStatusChange.bind(this, true));
    window.addEventListener("offline", this.handleNetworkStatusChange.bind(this, false));
  }
  
  /**
   * Handle network status changes
   */
  handleNetworkStatusChange(isOnline) {
    console.log(`Network status changed: ${isOnline ? 'online' : 'offline'}`);
    
    if (isOnline) {
      // Reconnect WebSocket if needed
      if (this.state.components.wsManager && !this.state.components.wsManager.isWebSocketOpen()) {
        this.state.components.wsManager.connect().then(() => {
          if (this.state.currentRoomId) {
            this.state.components.wsManager.switchRoom(this.state.currentRoomId);
          }
        });
      }
      
      // Clear any network error messages
      const networkErrorBanner = document.getElementById("networkErrorBanner");
      if (networkErrorBanner) {
        networkErrorBanner.classList.add("hidden");
      }
    } else {
      // Show network error message
      let networkErrorBanner = document.getElementById("networkErrorBanner");
      if (!networkErrorBanner) {
        networkErrorBanner = document.createElement("div");
        networkErrorBanner.id = "networkErrorBanner";
        networkErrorBanner.className = "bg-yellow-500 text-white p-2 text-center font-bold fixed top-0 left-0 right-0 z-50";
        networkErrorBanner.textContent = "Network connection lost. Reconnecting...";
        document.body.prepend(networkErrorBanner);
      } else {
        networkErrorBanner.classList.remove("hidden");
      }
    }
  }

  /**
   * Handle browser back/forward navigation
   */
  async handlePopState(event) {
    const newPath = window.location.pathname;
    this.state.currentPath = newPath;
    const roomId = this.extractRoomIdFromPath(newPath);

    if (roomId) {
      await this.switchRoom(roomId);
    } else if (newPath === "/chat") {
      if (this.state.components.chatManager) {
        this.state.components.chatManager.cleanup();
        this.state.components.chatManager = null;
      }
      this.state.currentRoomId = null;
      await this.showBaseView();
    }
  }

  /**
   * Update notification permission button UI
   */
  updateNotificationPermissionButton() {
    if (!this.state.components.notificationManager) return;

    const btn = document.getElementById("notificationToggle");
    if (!btn) return;

    const status = this.state.components.notificationManager.getPermissionStatus();
    btn.classList.remove("disabled", "enabled");

    if (status === "granted") {
      btn.classList.add("enabled");
      btn.setAttribute("title", "Notifications enabled");
    } else if (status === "denied") {
      btn.classList.add("disabled");
      btn.setAttribute("title", "Notifications blocked - check browser settings");
    } else {
      btn.setAttribute("title", "Enable notifications");
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
      this.state.components.wsManager &&
      !this.state.components.wsManager.isWebSocketOpen()
    ) {
      this.state.components.wsManager.connect().then(() => {
        if (this.state.currentRoomId) {
          this.state.components.wsManager.switchRoom(this.state.currentRoomId);
        }
      });
    }

    // Notify components
    this.state.components.chatManager?.handleVisibilityChange(isVisible);
    this.state.components.sidebar?.handleVisibilityChange(isVisible);
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
        wsManager: !!this.state.components.wsManager,
        sidebar: !!this.state.components.sidebar,
        chatManager: !!this.state.components.chatManager,
      },
    });

    // Show error message to user with retry button
    const errorMessage = "Failed to initialize application.";
    const existingBanner = document.querySelector(".error-banner");

    if (existingBanner) {
      existingBanner.textContent = errorMessage;
    } else {
      const banner = document.createElement("div");
      banner.className = "error-banner bg-red-500 text-white p-4 text-center font-bold fixed top-0 left-0 right-0 z-50";
      
      const messageSpan = document.createElement("span");
      messageSpan.textContent = errorMessage;
      banner.appendChild(messageSpan);
      
      // Add retry button
      const retryButton = document.createElement("button");
      retryButton.className = "ml-4 bg-white text-red-500 px-3 py-1 rounded hover:bg-gray-100";
      retryButton.textContent = "Retry";
      retryButton.addEventListener("click", () => {
        banner.textContent = "Retrying...";
        window.location.reload();
      });
      
      banner.appendChild(retryButton);
      document.body.prepend(banner);
    }
  }

  /**
   * Clean up resources and event listeners with improved thoroughness
   */
  cleanup() {
    // Remove event listeners
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    window.removeEventListener("popstate", this.handlePopState);
    window.removeEventListener("online", this.handleNetworkStatusChange);
    window.removeEventListener("offline", this.handleNetworkStatusChange);

    // Clean up components
    const componentsToCleanup = [
      "chatManager",
      "sidebar",
      "userInviteManager",
      "notificationManager",
      "wsManager"
    ];
    
    componentsToCleanup.forEach(componentName => {
      const component = this.state.components[componentName];
      if (component?.cleanup) {
        try {
          component.cleanup();
        } catch (error) {
          console.warn(`Error cleaning up ${componentName}:`, error);
        }
      }
      this.state.components[componentName] = null;
    });

    this.state.initialized = false;
  }
}

// Initialize application with error handling
document.addEventListener("DOMContentLoaded", () => {
  try {
    window.app = new App();
    window.app.initialize().catch((error) => {
      console.error("Failed to initialize app:", error);
    });
  } catch (error) {
    console.error("Critical application error:", error);
  }
}
);

export default App;
