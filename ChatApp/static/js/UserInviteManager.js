import authAxios from "./authAxios.js";

class UserInviteManager {
  constructor() {
    // DOM elements
    this.elements = {
      invite: {
        btn: document.getElementById("inviteUsersBtn"),
        modal: document.getElementById("userSearchModal"),
        closeBtn: document.getElementById("closeSearchModal"),
        doneBtn: document.getElementById("doneInviting"),
        searchInput: document.getElementById("userSearchInput"),
        resultsContainer: document.getElementById("userSearchResults"),
        loadingIndicator: document.getElementById("loadingSearchResults"),
        noResultsMessage: document.getElementById("noResultsMessage"),
        alreadyInvitedContainer: document.getElementById("alreadyInvitedUsers"),
      },
      pending: {
        container: document.getElementById("pendingInvitesContainer"),
        list: document.getElementById("pendingInvitesList"),
        loading: document.getElementById("loadingInvites"),
        noInvitesMessage: document.getElementById("noInvitesMessage"),
      },
    };

    // State
    this.currentRoomId = null;
    this.searchTimeout = null;
    this.invitedUsers = new Set();
    this.isRoomsView = window.location.pathname === "/chat";

    // Bind methods to preserve this context
    this.bindMethods();
  }

  bindMethods() {
    this.initialize = this.initialize.bind(this);
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.handleSearchInput = this.handleSearchInput.bind(this);
    this.searchUsers = this.searchUsers.bind(this);
    this.renderSearchResults = this.renderSearchResults.bind(this);
    this.inviteUser = this.inviteUser.bind(this);
    this.loadPendingInvites = this.loadPendingInvites.bind(this);
    this.renderPendingInvites = this.renderPendingInvites.bind(this);
    this.handleAcceptInvite = this.handleAcceptInvite.bind(this);
    this.handleDeclineInvite = this.handleDeclineInvite.bind(this);
    this.updateRoomContext = this.updateRoomContext.bind(this);
  }

  initialize() {
    const { invite } = this.elements;

    // Add event listeners
    invite.btn.addEventListener("click", this.openModal);
    invite.closeBtn.addEventListener("click", this.closeModal);
    invite.doneBtn.addEventListener("click", this.closeModal);
    invite.searchInput.addEventListener("input", this.handleSearchInput);

    // Show/hide invite button based on context
    this.updateInviteButtonVisibility();

    // Load pending invites if on rooms view
    if (this.isRoomsView) {
      this.loadPendingInvites();
    }

    return true;
  }

  updateRoomContext(roomId) {
    this.currentRoomId = roomId;
    this.updateInviteButtonVisibility();
  }

  updateInviteButtonVisibility() {
    const { btn } = this.elements.invite;
    // Only show invite button when in a specific room
    this.currentRoomId
      ? btn.classList.remove("hidden")
      : btn.classList.add("hidden");
  }

  openModal() {
    if (!this.currentRoomId) return;

    const { invite } = this.elements;

    // Reset UI state
    invite.searchInput.value = "";
    invite.resultsContainer.innerHTML = "";
    invite.noResultsMessage.classList.add("hidden");
    invite.loadingIndicator.classList.add("hidden");
    invite.alreadyInvitedContainer.innerHTML = "";

    // Reset state
    this.invitedUsers.clear();

    // Load current room members
    this.loadRoomMembers();

    // Show modal
    invite.modal.classList.remove("hidden");
  }

  closeModal() {
    this.elements.invite.modal.classList.add("hidden");
  }

  handleSearchInput(e) {
    const query = e.target.value.trim();
    const { resultsContainer, loadingIndicator, noResultsMessage } =
      this.elements.invite;

    // Clear existing timeout
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // Clear results if query is empty
    if (!query) {
      resultsContainer.innerHTML = "";
      noResultsMessage.classList.add("hidden");
      return;
    }

    // Show loading indicator
    loadingIndicator.classList.remove("hidden");
    noResultsMessage.classList.add("hidden");

    // Debounce search to avoid excessive API calls
    this.searchTimeout = setTimeout(() => this.searchUsers(query), 300);
  }

  async searchUsers(query) {
    const { resultsContainer, loadingIndicator } = this.elements.invite;

    try {
      const response = await authAxios.get(
        `/users/search?q=${encodeURIComponent(query)}`
      );
      this.renderSearchResults(response.data);
    } catch (error) {
      console.error("Error searching users:", error);
      loadingIndicator.classList.add("hidden");
      resultsContainer.innerHTML = `
        <div class="py-4 text-center text-red-500">
          Failed to search users. Please try again.
        </div>
      `;
    }
  }

  renderSearchResults(users) {
    const { loadingIndicator, resultsContainer, noResultsMessage } =
      this.elements.invite;

    loadingIndicator.classList.add("hidden");
    resultsContainer.innerHTML = "";

    if (!users?.length) {
      noResultsMessage.classList.remove("hidden");
      return;
    }

    noResultsMessage.classList.add("hidden");

    users.forEach((user) => {
      // Skip users already in the room
      if (this.invitedUsers.has(user.id)) return;

      const userEl = document.createElement("li");
      userEl.className = "py-3 flex items-center justify-between";
      userEl.innerHTML = `
        <div class="flex items-center">
          <div class="w-10 h-10 bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center">
            <span class="text-indigo-800 dark:text-indigo-200 font-medium">${user.username
              .charAt(0)
              .toUpperCase()}</span>
          </div>
          <div class="ml-3">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">${
              user.username
            }</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">${
              user.email
            }</p>
          </div>
        </div>
        <button class="invite-user-btn px-3 py-1.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-100 rounded-lg text-sm hover:bg-indigo-200 dark:hover:bg-indigo-700 transition-colors" data-user-id="${
          user.id
        }">
          Invite
        </button>
      `;

      const inviteBtn = userEl.querySelector(".invite-user-btn");
      inviteBtn.addEventListener("click", () => this.inviteUser(user));

      resultsContainer.appendChild(userEl);
    });
  }

  async inviteUser(user) {
    const { resultsContainer, alreadyInvitedContainer } = this.elements.invite;

    try {
      // Create payload with exact field names to match backend expectations
      const payload = {
        room_id: this.currentRoomId,
        userId: user.id,
      };

      // Send invite request
      await authAxios.post("/room/invite", payload);

      // Add user to invited list
      this.invitedUsers.add(user.id);

      // Remove from search results
      const userElements = resultsContainer.querySelectorAll(
        `[data-user-id="${user.id}"]`
      );
      userElements.forEach((el) => {
        const listItem = el.closest("li");
        if (listItem) listItem.remove();
      });

      // Add to already invited list
      const invitedEl = document.createElement("li");
      invitedEl.className = "py-3 flex items-center justify-between";
      invitedEl.innerHTML = `
        <div class="flex items-center">
          <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <span class="text-gray-700 dark:text-gray-300 font-medium">${user.username
              .charAt(0)
              .toUpperCase()}</span>
          </div>
          <div class="ml-3">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">${
              user.username
            }</p>
          </div>
        </div>
        <span class="text-xs text-green-600 dark:text-green-400">
          <i class="fas fa-check mr-1"></i> Invited
        </span>
      `;

      alreadyInvitedContainer.appendChild(invitedEl);
    } catch (error) {
      console.error("Invite user error:", error);
      this.showToast("Failed to send invitation", "error");
    }
  }

  showToast(message, type = "info") {
    // Create toast element
    const toast = document.createElement("div");
    toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-white 
                      ${
                        type === "success"
                          ? "bg-green-500"
                          : type === "error"
                          ? "bg-red-500"
                          : "bg-blue-500"
                      }
                      transform transition-transform duration-300 translate-y-0`;
    toast.textContent = message;

    // Add to document and remove after delay
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("translate-y-full", "opacity-0");
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
  }

  async loadRoomMembers() {
    if (!this.currentRoomId) return;

    try {
      // Get room members
      const response = await authAxios.get(
        `/rooms/${this.currentRoomId}/members`
      );
      const members = response.data;

      // Mark members as already invited
      members.forEach((member) => this.invitedUsers.add(member.id));

      // Load pending invites for this room
      const invitesResponse = await authAxios.get(
        `/rooms/${this.currentRoomId}/invites`
      );
      const invites = invitesResponse.data;

      this.addInvitedUsersToUI(invites);
    } catch (error) {
      console.error("Error loading room members:", error);
    }
  }

  addInvitedUsersToUI(invites) {
    const { alreadyInvitedContainer } = this.elements.invite;

    invites.forEach((invite) => {
      this.invitedUsers.add(invite.userId);

      const invitedEl = document.createElement("li");
      invitedEl.className = "py-3 flex items-center justify-between";
      invitedEl.innerHTML = `
        <div class="flex items-center">
          <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <span class="text-gray-700 dark:text-gray-300 font-medium">${invite.username
              .charAt(0)
              .toUpperCase()}</span>
          </div>
          <div class="ml-3">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">${
              invite.username
            }</p>
          </div>
        </div>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          <i class="fas fa-clock mr-1"></i> Pending
        </span>
      `;

      alreadyInvitedContainer.appendChild(invitedEl);
    });
  }

  async loadPendingInvites() {
    const { pending } = this.elements;
    if (!this.isRoomsView || !pending.container) return;

    try {
      // Show loading state
      pending.container.classList.remove("hidden");
      pending.loading.classList.remove("hidden");
      pending.noInvitesMessage.classList.add("hidden");
      pending.list.innerHTML = "";

      // Fetch pending invites
      const response = await authAxios.get("/invites/pending");
      pending.loading.classList.add("hidden");

      this.renderPendingInvites(response.data);
    } catch (error) {
      console.error("Error loading pending invites:", error);
      pending.loading.classList.add("hidden");
      pending.list.innerHTML = `
        <div class="py-4 text-center text-red-500">
          Failed to load pending invites. Please refresh the page.
        </div>
      `;
    }
  }

  renderPendingInvites(invites) {
    const { pending } = this.elements;

    if (!invites?.length) {
      pending.noInvitesMessage.classList.remove("hidden");
      return;
    }

    // Get template and clear previous list
    const template = document.getElementById("pendingInviteTemplate");
    pending.list.innerHTML = "";

    // Add each invite
    invites.forEach((invite) => {
      const inviteItem = template.content.cloneNode(true);

      // Set content
      inviteItem.querySelector(".invite-room-name").textContent =
        invite.roomName;
      inviteItem.querySelector(".invite-from").textContent = invite.invitedBy;
      inviteItem.querySelector(".invite-date").textContent = new Date(
        invite.createdAt
      ).toLocaleDateString();

      // Add invite ID to list item
      const listItem =
        inviteItem.querySelector("li") || inviteItem.firstElementChild;
      if (listItem) {
        listItem.setAttribute("data-invite-id", invite.id);
      }

      // Add event listeners
      const acceptBtn = inviteItem.querySelector(".accept-invite-btn");
      const declineBtn = inviteItem.querySelector(".decline-invite-btn");

      acceptBtn.addEventListener("click", () =>
        this.handleAcceptInvite(invite.id)
      );
      declineBtn.addEventListener("click", () =>
        this.handleDeclineInvite(invite.id)
      );

      // Add to list
      pending.list.appendChild(inviteItem);
    });

    // Make container visible
    pending.container.classList.remove("hidden");
  }

  async handleAcceptInvite(inviteId) {
    try {
      const response = await authAxios.post(`/invites/${inviteId}/accept`);
      const result = response.data;

      this.showToast("Invitation accepted. Joining room...", "success");
      this.removeInviteFromList(inviteId);

      // Navigate to room after a short delay
      setTimeout(() => {
        window.location.href = `/chat/${result.roomId}`;
      }, 1000);
    } catch (error) {
      console.error("Error accepting invite:", error);
      this.showToast("Failed to accept invitation", "error");
    }
  }

  async handleDeclineInvite(inviteId) {
    try {
      await authAxios.post(`/invites/${inviteId}/decline`);
      this.removeInviteFromList(inviteId);
    } catch (error) {
      console.error("Error declining invite:", error);
    }
  }

  removeInviteFromList(inviteId) {
    const { list, noInvitesMessage } = this.elements.pending;

    // Find and remove invite element
    const inviteElements = list.querySelectorAll(
      `[data-invite-id="${inviteId}"]`
    );
    inviteElements.forEach((el) => el.remove());

    // Show no invites message if list is empty
    if (list.children.length === 0) {
      noInvitesMessage.classList.remove("hidden");
    }
  }

  cleanup() {
    const { invite } = this.elements;

    // Remove event listeners
    invite.btn?.removeEventListener("click", this.openModal);
    invite.closeBtn?.removeEventListener("click", this.closeModal);
    invite.doneBtn?.removeEventListener("click", this.closeModal);
    invite.searchInput?.removeEventListener("input", this.handleSearchInput);
  }
}

export default UserInviteManager;
