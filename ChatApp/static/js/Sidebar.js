import authAxios from "./authAxios.js";

class Sidebar {
  constructor() {
    this.wsManager = null;
    this.isInitialized = false;
    this.isLoading = false;
    this.isMobile = window.innerWidth < 768;
    this.activeRoomId = this.getActiveRoomId();
    this.api = authAxios;
    this.onRoomClickCallback = null;
    this.currentUser = null;
    this.rooms = [];

    // Bind methods that are used as callbacks
    this.handleWebSocketMessage = this.handleWebSocketMessage.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleResponsiveLayout = this.handleResponsiveLayout.bind(this);
    this.handleRoomItemClick = this.handleRoomItemClick.bind(this);
    this.handleRoomAction = this.handleRoomAction.bind(this);

    // Create debounced handlers
    this.debouncedResize = this.debounce(this.handleResponsiveLayout, 150);
    this.debouncedRoomsUpdate = this.debounce(this.loadRooms, 300);
  }

  getActiveRoomId() {
    const match = window.location.pathname.match(/\/chat\/([^\/]+)/);
    return match ? match[1] : null;
  }

  onRoomClick(callback) {
    if (typeof callback === "function") {
      this.onRoomClickCallback = callback;
    }
  }

  initializeElements() {
    // Get DOM elements
    this.sidebar = document.getElementById("sidebar");
    this.toggleSidebar = document.getElementById("toggleSidebar");
    this.closeSidebar = document.getElementById("closeSidebar");
    this.roomsList = document.getElementById("roomsList");
    this.actionButton = document.getElementById("actionButton");
    this.dropdownMenu = document.getElementById("dropdownMenu");
    this.roomModal = document.getElementById("roomModal");
    this.createRoomBtn = document.getElementById("createRoomBtn");
    this.joinRoomBtn = document.getElementById("joinRoomBtn");
    this.createRoomForm = document.getElementById("createRoomForm");
    this.joinRoomForm = document.getElementById("joinRoomForm");
    this.confirmCreateRoom = document.getElementById("confirmCreateRoom");
    this.confirmJoinRoom = document.getElementById("confirmJoinRoom");
    this.newRoomName = document.getElementById("newRoomName");
    this.roomCodeInput = document.getElementById("roomCodeInput");

    // Set up sidebar styling
    if (this.sidebar) {
      this.sidebar.classList.add(
        "bg-white",
        "dark:bg-gray-900",
        "transition-all",
        "duration-300",
        "ease-in-out",
        "fixed",
        "inset-y-0",
        "left-0",
        "z-40",
        "md:static",
        "md:translate-x-0",
        "w-72",
        "shadow-lg",
        "border-r",
        "border-gray-200",
        "dark:border-gray-700"
      );

      if (this.isMobile) {
        this.sidebar.classList.add("-translate-x-full");
      }
    }
  }

  async initialize(wsManager, currentUser) {
    if (!wsManager) {
      throw new Error("WebSocket manager is required for initialization");
    }

    if (this.isInitialized) return true;

    try {
      this.wsManager = wsManager;
      this.currentUser = currentUser;
      this.initializeElements();

      // Set up event listeners and handlers
      this.wsManager.addMessageHandler(this.handleWebSocketMessage);
      this.attachEventListeners();
      document.addEventListener("visibilitychange", () =>
        this.handleVisibilityChange(!document.hidden)
      );

      // Initial rooms loading
      await this.loadRooms();

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error("Sidebar initialization failed:", error);
      this.cleanup();
      return false;
    }
  }

  handleVisibilityChange(isVisible) {
    if (isVisible && !this.isLoading) {
      this.loadRooms();
    }
  }

  attachEventListeners() {
    // Sidebar toggle
    if (this.toggleSidebar) {
      this.toggleSidebar.addEventListener("click", () =>
        this.toggleSidebarVisibility()
      );
    }

    if (this.closeSidebar) {
      this.closeSidebar.addEventListener("click", () =>
        this.toggleSidebarVisibility(false)
      );
    }

    // Window resize
    window.addEventListener("resize", this.debouncedResize);

    // Room management buttons
    if (this.createRoomBtn) {
      this.createRoomBtn.addEventListener("click", () =>
        this.showModal("create")
      );
    }

    if (this.joinRoomBtn) {
      this.joinRoomBtn.addEventListener("click", () => this.showModal("join"));
    }

    // Modal actions
    if (this.confirmCreateRoom) {
      this.confirmCreateRoom.addEventListener("click", () => this.createRoom());
    }

    if (this.confirmJoinRoom) {
      this.confirmJoinRoom.addEventListener("click", () => this.joinRoom());
    }

    // Room list delegation
    if (this.roomsList) {
      this.roomsList.addEventListener("click", this.handleRoomItemClick);
      this.roomsList.addEventListener("click", this.handleRoomAction);
    }

    // Action button & dropdown
    if (this.actionButton) {
      this.actionButton.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });
    }

    // Global event handlers
    document.addEventListener("click", (e) => {
      // Close modal on cancel
      if (e.target.closest(".cancel-modal")) {
        this.hideModal();
      }

      // Close dropdown when clicking outside
      if (
        this.dropdownMenu &&
        !this.dropdownMenu.classList.contains("hidden") &&
        this.actionButton &&
        !this.actionButton.contains(e.target) &&
        !this.dropdownMenu.contains(e.target)
      ) {
        this.dropdownMenu.classList.add("hidden");
      }
    });
  }

  handleRoomItemClick(e) {
    const roomItem = e.target.closest(".room-item");
    if (roomItem && !e.target.closest(".delete-room, .leave-room")) {
      const roomId = roomItem.dataset.roomId;

      // Update active room UI
      this.updateActiveRoom(roomId);

      // Use callback from App if available, otherwise navigate
      if (this.onRoomClickCallback) {
        e.preventDefault();
        this.onRoomClickCallback(roomId);

        // Hide sidebar on mobile after selection
        if (this.isMobile) {
          this.toggleSidebarVisibility(false);
        }
      } else {
        window.location.href = `/chat/${roomId}`;
      }
    }
  }

  handleRoomAction(e) {
    const deleteBtn = e.target.closest(".delete-room");
    const leaveBtn = e.target.closest(".leave-room");

    if (!deleteBtn && !leaveBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const roomItem = e.target.closest(".room-item");
    if (!roomItem) return;

    const roomId = roomItem.dataset.roomId;
    const roomName = roomItem.querySelector("h3").textContent.trim();

    if (deleteBtn) {
      this.confirmRoomAction(
        "Delete Room",
        `Are you sure you want to delete "${roomName}"? This action cannot be undone.`,
        () => this.deleteRoom(roomId)
      );
    } else if (leaveBtn) {
      this.confirmRoomAction(
        "Leave Room",
        `Are you sure you want to leave "${roomName}"?`,
        () => this.leaveRoom(roomId)
      );
    }
  }

  confirmRoomAction(title, message, actionCallback) {
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
    modal.id = "confirmActionModal";

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full">
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">${title}</h3>
        <p class="text-gray-600 dark:text-gray-300 mb-4">${message}</p>
        <div class="flex justify-end gap-2">
          <button id="cancelAction" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
            Cancel
          </button>
          <button id="confirmAction" class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
            Confirm
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("cancelAction").addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    document.getElementById("confirmAction").addEventListener("click", () => {
      document.body.removeChild(modal);
      actionCallback();
    });
  }

  async deleteRoom(roomId) {
    try {
      await this.api.delete(`/rooms/${roomId}`);
      await this.loadRooms();

      // Redirect if the deleted room was active
      if (roomId === this.activeRoomId) {
        window.location.href = "/chat";
      }
    } catch (error) {
      console.error("Failed to delete room:", error);
      this.showToast("Failed to delete room. Please try again.", "error");
    }
  }

  async leaveRoom(roomId) {
    try {
      await this.api.delete(`/rooms/${roomId}/leave`);
      await this.loadRooms();

      // Redirect if the left room was active
      if (roomId === this.activeRoomId) {
        window.location.href = "/chat";
      }
    } catch (error) {
      console.error("Failed to leave room:", error);
      this.showToast("Failed to leave room. Please try again.", "error");
    }
  }

  showToast(message, type = "error") {
    const toast = document.createElement("div");
    const bgColor = type === "error" ? "bg-red-500" : "bg-blue-500";

    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded shadow-lg z-50 animate-fade-in`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.add("animate-fade-out");
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 3000);
  }

  getRooms() {
    return this.rooms ? [...this.rooms] : [];
  }

  updateActiveRoom(roomId) {
    this.activeRoomId = roomId;

    if (!this.roomsList) return;

    // Remove active class from all rooms
    const rooms = this.roomsList.querySelectorAll(".room-item");
    rooms.forEach((room) => {
      room.classList.remove(
        "bg-blue-50",
        "dark:bg-blue-900/20",
        "border-l-4",
        "border-blue-500"
      );
      room.classList.add("hover:bg-gray-50", "dark:hover:bg-gray-800");
    });

    // Add active class to selected room
    const activeRoom = this.roomsList.querySelector(
      `[data-room-id="${roomId}"]`
    );
    if (activeRoom) {
      activeRoom.classList.add(
        "bg-blue-50",
        "dark:bg-blue-900/20",
        "border-l-4",
        "border-blue-500"
      );
      activeRoom.classList.remove("hover:bg-gray-50", "dark:hover:bg-gray-800");
    }
  }

  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async loadRooms() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await this.api.get("/rooms", {
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      clearTimeout(timeoutId);
      this.rooms = response.data;
      this.updateRoomsList(response.data);
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Room fetch request timed out");
      } else {
        console.error("Failed to load rooms:", error);
      }
    } finally {
      this.isLoading = false;
    }
  }

  updateRoomsList(rooms) {
    if (!this.roomsList) return;

    const fragment = document.createDocumentFragment();

    rooms.forEach((room) => {
      const isActive = room.id === this.activeRoomId;
      const roomElement = this.createRoomElement(room, isActive);
      fragment.appendChild(roomElement);
    });

    // Replace contents in one operation
    this.roomsList.innerHTML = "";
    this.roomsList.appendChild(fragment);
  }

  createRoomElement(room, isActive) {
    const div = document.createElement("div");
    const isOwner =
      this.currentUser && room.created_by === this.currentUser.email;

    div.className = `room-item relative transition-all duration-200 ${
      isActive
        ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500"
        : "hover:bg-gray-50 dark:hover:bg-gray-800"
    } cursor-pointer flex items-center p-4 gap-3 group`;

    div.dataset.roomId = room.id;

    div.innerHTML = `
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
        ${room.name.charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <h3 class="font-medium truncate dark:text-white">${room.name}</h3>
        </div>
      </div>
      ${
        isOwner
          ? `<button class="delete-room absolute right-2 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1 rounded transition-opacity" title="Delete Room">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
          </svg>
        </button>`
          : `<button class="leave-room absolute right-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-700 p-1 rounded transition-opacity" title="Leave Room">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"/>
            <path fill-rule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
          </svg>
        </button>`
      }
    `;

    return div;
  }

  toggleDropdown() {
    if (this.dropdownMenu) {
      this.dropdownMenu.classList.toggle("hidden");
    }
  }

  toggleSidebarVisibility(show) {
    if (!this.sidebar) return;

    const isVisible =
      show ?? this.sidebar.classList.contains("-translate-x-full");
    this.sidebar.classList.toggle("-translate-x-full", !isVisible);
  }

  handleResponsiveLayout() {
    if (!this.sidebar) return;

    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 768;

    // Only update if state changed
    if (wasMobile !== this.isMobile) {
      this.sidebar.classList.toggle("-translate-x-full", this.isMobile);
    }
  }

  showModal(type) {
    if (!this.roomModal) return;

    this.roomModal.classList.remove("hidden");

    if (this.createRoomForm) {
      this.createRoomForm.classList.toggle("hidden", type !== "create");
    }

    if (this.joinRoomForm) {
      this.joinRoomForm.classList.toggle("hidden", type !== "join");
    }

    // Focus the appropriate input
    if (type === "create" && this.newRoomName) {
      this.newRoomName.focus();
    } else if (type === "join" && this.roomCodeInput) {
      this.roomCodeInput.focus();
    }
  }

  hideModal() {
    if (this.roomModal) {
      this.roomModal.classList.add("hidden");
    }

    // Reset input fields
    if (this.newRoomName) {
      this.newRoomName.value = "";
    }

    if (this.roomCodeInput) {
      this.roomCodeInput.value = "";
    }
  }

  async createRoom() {
    if (!this.newRoomName) return;

    const name = this.newRoomName.value.trim();
    if (!name) return;

    try {
      await this.api.post("/rooms", { name });
      this.hideModal();
      await this.loadRooms();
    } catch (error) {
      console.error("Failed to create room:", error);
      this.showToast("Failed to create room. Please try again.", "error");
    }
  }

  async joinRoom() {
    if (!this.roomCodeInput) return;

    const code = this.roomCodeInput.value.trim();
    if (!code) return;

    try {
      const { data: room } = await this.api.post("/rooms/join", { code });
      this.hideModal();
      window.location.href = `/chat/${room.id}`;
    } catch (error) {
      console.error("Failed to join room:", error);
      this.showToast(
        "Failed to join room. Invalid code or room not found.",
        "error"
      );
    }
  }

  // This method is missing implementation in the original code
  handleWebSocketMessage(message) {
    // Handle WebSocket messages related to rooms
    if (message && message.type === "room_update") {
      this.debouncedRoomsUpdate();
    }
  }

  cleanup() {
    // Remove WebSocket handler
    if (this.wsManager) {
      this.wsManager.removeMessageHandler(this.handleWebSocketMessage);
    }

    // Remove event listeners
    window.removeEventListener("resize", this.debouncedResize);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );

    // Reset state
    this.isInitialized = false;
  }
}

export default Sidebar;
