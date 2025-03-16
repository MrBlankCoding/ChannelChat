import ChatUI from "./ChatUI.js";
import { initFirebase } from "./firebaseConfig.js";
import authAxios from "./authAxios.js";

class ChatManager {
  constructor() {
    // Core
    this.roomId = null;
    this.currentUser = null;
    this.ui = new ChatUI();
    this.ui.setChatManager(this);
    this.wsManager = null;

    // Pagination
    this.nextCursor = null;
    this.isLoadingMore = false;
    this.hasMoreMessages = true;

    // State tracking
    this.processedMessages = new Map();
    this.typingUsers = new Set();
    this.unreadMessages = new Set();
    this.isTabActive = !document.hidden;

    // Firebase
    this.firebaseApp = null;
    this.storage = null;
    this.storageUtils = null;
    this.currentRoom = null;

    // API
    this.api = authAxios;

    // Bind critical methods
    this.handleWebSocketMessage = this.handleWebSocketMessage.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    // Message handlers map for faster lookups
    this.messageHandlers = {
      message: this.handleNewMessage.bind(this),
      image: this.handleNewMessage.bind(this),
      typing_status: this.handleTypingStatus.bind(this),
      user_joined: this.handleUserJoined.bind(this),
      user_left: this.handleUserLeft.bind(this),
      read_receipt: this.handleReadReceipt.bind(this),
      emoji_reaction: this.handleEmojiReaction.bind(this),
      message_edited: this.handleMessageEdit.bind(this),
      message_deleted: this.handleMessageDelete.bind(this),
      unread_update: this.handleUnreadUpdate.bind(this),
      error: (msg) => this.ui.showError(msg.message),
    };

    // Cache DOM selectors
    this.messagesContainer = null;
  }

  async initialize(wsManager) {
    if (!wsManager) {
      throw new Error("WebSocket manager is required for initialization");
    }

    // Clear previous state if reusing the instance
    this.cleanup(false);
    this.wsManager = wsManager;
    this.ui.setLoading(true);

    try {
      // Set room ID from URL if not provided
      if (!this.roomId) {
        this.roomId = window.location.pathname.split("/").pop();
      }

      // Initialize Firebase if needed
      if (!this.firebaseApp) {
        const { app, storage, storageUtils } = await initFirebase();
        this.firebaseApp = app;
        this.storage = storage;
        this.storageUtils = storageUtils;
      }

      // Fetch room data
      const roomResponse = await this.api.get(`/rooms/${this.roomId}`);
      this.currentRoom = roomResponse.data;

      // Validate required data
      if (!this.currentUser || !this.currentRoom) {
        throw new Error("Missing user or room data");
      }

      // Setup UI and WebSocket
      this.ui.setCurrentUser(this.currentUser);
      if (!this.wsManager.currentUser) {
        this.wsManager.setCurrentUser(this.currentUser);
      }

      // Setup UI components
      this.ui.updateRoomInfo(this.currentRoom);
      this.ui.setupEventListeners();
      this.messagesContainer = document.querySelector(".messages-container");

      // Register for WebSocket messages
      this.wsManager.addMessageHandler(this.handleWebSocketMessage);

      // Load messages and setup event listeners
      await this.loadInitialMessages();
      this.setupScrollListener();
      this.setupEventListeners();

      return true;
    } catch (error) {
      console.error("ChatManager initialization failed:", error);
      this.ui.showError(error.message || "Failed to initialize chat");
      this.cleanup();
      return false;
    } finally {
      this.ui.setLoading(false);
      this.ui.enableForm(true);
    }
  }

  setupEventListeners() {
    window.addEventListener("beforeunload", this.cleanup.bind(this));
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  handleVisibilityChange() {
    this.isTabActive = !document.hidden;

    if (this.isTabActive) {
      this.unreadMessages.clear();
      document.title = this.originalTitle;
      // Throttle read receipts
      requestAnimationFrame(() => this.markVisibleMessagesAsRead());
    }
  }

  handleWebSocketMessage(data) {
    const handler = this.messageHandlers[data.type];
    if (handler) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error handling message type ${data.type}:`, error);
        this.ui.showError(`Error processing ${data.type} message`);
      }
    }
  }

  handleUnreadUpdate() {
    // Placeholder for future implementation
  }

  handleReadReceipt(data) {
    // Skip if current user is the one who read the message
    if (
      data.read_by === this.currentUser.username ||
      data.read_by === this.currentUser.id
    ) {
      return;
    }

    const updateReadStatus = (messageId) => {
      const msgElement = document.querySelector(
        `[data-message-id="${messageId}"]`
      );
      if (
        msgElement &&
        msgElement.getAttribute("data-username") !== this.currentUser.username
      ) {
        this.ui.updateMessageReadStatus(messageId, data.read_by, true);
      }
    };

    // Batch DOM updates
    requestAnimationFrame(() => {
      if (Array.isArray(data.message_ids)) {
        data.message_ids.forEach(updateReadStatus);
      } else if (data.message_id) {
        updateReadStatus(data.message_id);
      }
    });
  }

  handleTypingStatus(data) {
    const userId = data.user_id || data.username;
    if (!userId) return;

    // Skip if current user
    const isCurrentUser =
      userId === this.currentUser.id ||
      data.username === this.currentUser.username;
    if (isCurrentUser) return;

    // Update typing status
    if (data.is_typing) {
      this.typingUsers.add(userId);
    } else {
      this.typingUsers.delete(userId);
    }

    // Throttle UI updates
    if (!this._typingUpdateScheduled) {
      this._typingUpdateScheduled = true;
      requestAnimationFrame(() => {
        this.ui.updateTypingIndicator(this.typingUsers);
        this._typingUpdateScheduled = false;
      });
    }
  }

  handleEmojiReaction(data) {
    this.ui.updateMessageReactions(data.message_id, data.emoji, data.username);
  }

  handleMessageEdit(data) {
    this.ui.updateMessage(data.message_id, data.content, true);
  }

  handleMessageDelete(data) {
    this.ui.deleteMessage(data.message_id);
  }

  handleNewMessage(data) {
    const messageKey = `${data.id}-${data.content}`;

    // Skip if already processed
    if (this.processedMessages.has(messageKey)) return;
    this.processedMessages.set(messageKey, Date.now());

    // Prepare message data
    const messageData = {
      ...data,
      type: data.message_type || data.type || "text",
    };

    // Check for temporary message to update
    const existingMessage = document.querySelector(
      `[data-message-id="${data.temp_id}"]`
    );
    if (existingMessage) {
      existingMessage.setAttribute("data-message-id", data.id);
      if (data.read_by?.length > 0) {
        this.ui.updateMessageReadStatus(data.id, data.read_by);
      }
    } else {
      this.ui.appendMessage(messageData);
      if (this.isTabActive && data.username !== this.currentUser.username) {
        requestAnimationFrame(() => this.markVisibleMessagesAsRead());
      }
    }

    // Clean up old processed messages
    this.scheduleMessageCleanup();
  }

  scheduleMessageCleanup() {
    if (!this._cleanupScheduled) {
      this._cleanupScheduled = true;
      setTimeout(() => {
        const now = Date.now();
        // Remove messages older than 5 seconds
        for (const [key, timestamp] of this.processedMessages.entries()) {
          if (now - timestamp > 5000) {
            this.processedMessages.delete(key);
          }
        }
        this._cleanupScheduled = false;
      }, 5000);
    }
  }

  async uploadImage(file) {
    if (!this.storage || !this.storageUtils) {
      throw new Error("Firebase Storage not initialized");
    }

    try {
      const timestamp = Date.now();
      const fileName = `${timestamp}-${file.name}`;
      const storageRef = this.storageUtils.ref(
        this.storage,
        `chat-images/${this.roomId}/${fileName}`
      );
      const snapshot = await this.storageUtils.uploadBytes(storageRef, file);
      return await this.storageUtils.getDownloadURL(snapshot.ref);
    } catch (error) {
      console.error("Error uploading image:", error);
      throw error;
    }
  }

  async handleImageUpload(files) {
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (imageFiles.length === 0) return;

    try {
      this.ui.showUploadProgress(true);
      const imageUrls = await Promise.all(
        imageFiles.map((file) => this.uploadImage(file))
      );

      imageUrls.forEach((imageUrl) => {
        const tempId = this.wsManager.sendMessage({
          content: imageUrl,
          type: "image",
          roomId: this.roomId,
        });

        this.ui.appendMessage({
          id: tempId,
          content: imageUrl,
          type: "image",
          room_id: this.roomId,
          username: this.currentUser.username,
          timestamp: new Date().toISOString(),
        });
      });
    } catch (error) {
      this.ui.showError("Failed to upload image(s)");
      console.error("Image upload error:", error);
    } finally {
      this.ui.showUploadProgress(false);
    }
  }

  sendMessage(messageData) {
    const tempId = this.wsManager.sendMessage({
      content: messageData.content,
      type: messageData.type || "text",
      roomId: this.roomId,
      replyTo: messageData.replyTo,
    });

    this.ui.appendMessage({
      id: tempId,
      content: messageData.content,
      type: messageData.type || "text",
      room_id: this.roomId,
      username: this.currentUser.username,
      timestamp: new Date().toISOString(),
      reply_to: messageData.replyTo,
    });
  }

  addEmojiReaction(messageId, emoji) {
    this.wsManager.sendEmojiReaction(messageId, emoji);
  }

  deleteMessage(messageId) {
    this.wsManager.sendMessageDelete(messageId);
  }

  editMessage(messageId, newContent) {
    this.wsManager.sendMessageEdit(messageId, newContent);
  }

  prepareReply(messageId) {
    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    );
    if (!messageElement) return null;

    return {
      id: messageId,
      content: messageElement.querySelector(".message-content").textContent,
      username: messageElement.getAttribute("data-username"),
    };
  }

  sendTypingStatus(isTyping) {
    this.wsManager.sendTypingStatus(isTyping);
  }

  async loadInitialMessages() {
    const messages = await this.loadMessages();
    if (messages.length > 0) {
      this.ui.displayMessages(messages.reverse());
      requestAnimationFrame(() => this.markVisibleMessagesAsRead());
    }
  }

  async loadMessages(cursor = null) {
    try {
      const endpoint = `/messages/${this.roomId}${
        cursor ? `?cursor=${cursor}` : ""
      }`;
      const response = await this.api.get(endpoint);
      const { messages, next_cursor } = response.data;

      // Process messages
      const processedMessages = messages.map((message) => {
        const isImage =
          message.content?.includes("firebasestorage.googleapis.com") ||
          message.message_type === "image" ||
          message.type === "image";
        return {
          ...message,
          type: isImage ? "image" : "text",
        };
      });

      this.nextCursor = next_cursor;
      this.hasMoreMessages = !!next_cursor;

      return processedMessages;
    } catch (error) {
      console.error("Error loading messages:", error);
      this.ui.showError("Failed to load messages");
      return [];
    }
  }

  setupScrollListener() {
    if (!this.messagesContainer) {
      this.messagesContainer = document.querySelector(".messages-container");
      if (!this.messagesContainer) return;
    }

    this.messagesContainer.addEventListener(
      "scroll",
      this._handleScroll.bind(this),
      { passive: true }
    );
  }

  _handleScroll() {
    if (this._scrollTimeout) return;

    this._scrollTimeout = requestAnimationFrame(async () => {
      if (this.isLoadingMore || !this.hasMoreMessages) {
        this._scrollTimeout = null;
        return;
      }

      const { scrollTop } = this.messagesContainer;
      if (scrollTop <= 100) {
        await this.loadMoreMessages();
      }
      this._scrollTimeout = null;
    });
  }

  async loadMoreMessages() {
    if (this.isLoadingMore || !this.hasMoreMessages || !this.nextCursor) return;

    this.isLoadingMore = true;
    this.ui.showLoadingMore(true);

    try {
      const messages = await this.loadMessages(this.nextCursor);
      if (messages.length > 0) {
        window.requestAnimationFrame(() => {
          this.ui.prependMessages(messages);
        });
      }
    } finally {
      this.isLoadingMore = false;
      this.ui.showLoadingMore(false);
    }
  }

  markVisibleMessagesAsRead() {
    if (!this.isTabActive) return;

    const unreadMessages = [];
    const messages = document.querySelectorAll(
      ".message:not([data-read='true'])"
    );

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const messageId = msg.getAttribute("data-message-id");
      const username = msg.getAttribute("data-username");

      if (
        username !== this.currentUser.username &&
        messageId &&
        !messageId.startsWith("temp-")
      ) {
        unreadMessages.push(messageId);
        msg.setAttribute("data-read", "true");
      }
    }

    if (unreadMessages.length > 0) {
      this.wsManager.sendReadReceipt(unreadMessages);
    }
  }

  handleConnectionStatus(data) {
    this.ui.setConnectionStatus(data.status === "connected");
  }

  handleUserJoined(data) {
    // Placeholder for implementation
  }

  handleUserLeft(data) {
    // Placeholder for implementation
  }

  cleanup() {
    // Remove WebSocket message handler
    if (this.wsManager) {
      this.wsManager.removeMessageHandler(this.handleWebSocketMessage);
    }

    // Remove event listeners
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );
    if (this.messagesContainer) {
      this.messagesContainer.removeEventListener("scroll", this._handleScroll);
    }

    // Cancel any pending operations
    if (this._scrollTimeout) {
      cancelAnimationFrame(this._scrollTimeout);
    }

    // Clear UI state
    this.ui.setLoading(false);
    this.ui.clearMessages();

    // Reset internal state
    this.processedMessages.clear();
    this.typingUsers.clear();
    this.unreadMessages.clear();

    // Reset title
    document.title = this.originalTitle;

    // Reset Firebase references
    this.storage = null;
    this.storageUtils = null;
  }
}

export default ChatManager;
