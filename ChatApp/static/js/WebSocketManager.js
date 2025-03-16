import PresenceManager from "./PresenceManager.js";
import { getAuthToken } from "./auth.js";

/**
 * Manages WebSocket connections and message handling
 */
class WebSocketManager {
  constructor() {
    if (WebSocketManager.instance) {
      return WebSocketManager.instance;
    }
    WebSocketManager.instance = this;

    // Connection properties
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectBackoffMs = 1000;
    this.connectionState = "disconnected";
    this.connectionPromise = null;
    this.heartbeatInterval = null;
    this.heartbeatTimeoutMs = 30000;

    // User and room context
    this.currentUser = null;
    this.currentRoom = null;
    this.pendingRoomSwitch = null;

    // Message handling
    this.messageQueue = [];
    this.processingQueue = false;
    this.messageHandlers = new Set();
    this.messageCounter = 0;
    this.processedMessages = new Set();
    this.typingDebounceTimer = null;
    this.typingDebounceMs = 300;

    // Room switching
    this.roomSwitchCallbacks = new Map();
    this.roomSwitchTimeoutMs = 5000;
    this.switchingRoom = false;

    // Tab focus tracking
    this.isTabActive = !document.hidden;
    this.unreadCount = 0;

    // Initialize PresenceManager
    this.presenceManager = PresenceManager.getInstance();
    this.presenceManager.onStatusChange(this.handlePresenceChange.bind(this));

    // Bind methods to preserve 'this' context
    this.handleWebSocketMessage = this.handleWebSocketMessage.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.processMessageQueue = this.processMessageQueue.bind(this);
    this.sendHeartbeat = this.sendHeartbeat.bind(this);

    // Set up event listeners
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    // Start message queue processing
    this.queueProcessInterval = setInterval(this.processMessageQueue, 50);
  }

  /**
   * Returns the singleton instance of WebSocketManager
   */
  static getInstance() {
    return WebSocketManager.instance || new WebSocketManager();
  }

  setCurrentUser(user) {
    this.currentUser = user;
  }

  isBaseRoomView() {
    return window.location.pathname === "/chat";
  }

  /**
   * Connects to the WebSocket server
   * @param {string} path - Optional path to connect to
   * @returns {Promise} - Resolves when connected
   */
  async connect(path = null) {
    // If on base chat view without a room, don't establish connection
    if (this.isBaseRoomView() && !path) {
      console.log("On base chat route - no WebSocket connection needed yet");
      this.connectionState = "base_view";
      return Promise.resolve();
    }

    // Prevent multiple simultaneous connection attempts
    if (this.connectionState === "connecting") {
      return this.connectionPromise;
    }

    // If already connected and not switching rooms, return
    if (
      this.connectionState === "connected" &&
      this.isWebSocketOpen() &&
      !path
    ) {
      return Promise.resolve();
    }

    this.connectionState = "connecting";

    // Create a new connection promise
    this.connectionPromise = new Promise(async (resolve, reject) => {
      try {
        const token = await getAuthToken();

        if (!token) {
          this.connectionState = "disconnected";
          reject(new Error("No authentication token available"));
          return;
        }

        // Close existing connection if it exists
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
          this.closeExistingConnection();
        }

        // We must always have a roomId when establishing a connection
        if (!path) {
          console.error("No room ID provided for WebSocket connection");
          this.connectionState = "disconnected";
          reject(new Error("Room ID is required for WebSocket connection"));
          return;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const baseUrl = `${protocol}//${window.location.host}/ws/${token}`;
        const wsUrl = `${baseUrl}/${path}`;

        console.log(`Connecting to WebSocket at: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        // Set up connection timeout
        const connectionTimeout = setTimeout(() => {
          if (this.connectionState !== "connected") {
            this.ws.close();
            this.connectionState = "disconnected";
            reject(new Error("Connection timeout"));
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          console.log("WebSocket connected to room:", path);
          this.connectionState = "connected";
          this.currentRoom = path;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.notifyHandlers({
            type: "connection_status",
            status: "connected",
            room: path,
          });
          resolve();
        };

        this.ws.onclose = this.handleWebSocketClose.bind(this);
        this.ws.onerror = this.handleWebSocketError.bind(this);
        this.ws.onmessage = this.handleWebSocketMessage;
      } catch (error) {
        console.error("Error connecting to WebSocket:", error);
        this.connectionState = "disconnected";
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  /**
   * Closes the existing WebSocket connection
   */
  closeExistingConnection() {
    if (!this.ws) return;

    console.log("Closing existing WebSocket connection");
    this.stopHeartbeat();

    try {
      // Remove handlers to prevent reconnect logic
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;

      if (this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
    } catch (e) {
      console.error("Error closing WebSocket:", e);
    }

    this.ws = null;
  }

  /**
   * Handles WebSocket error events
   */
  handleWebSocketError(event) {
    console.error("WebSocket error:", event);
    this.notifyHandlers({
      type: "connection_status",
      status: "error",
      error: "Connection error",
    });
  }

  /**
   * Checks if the WebSocket is currently open
   */
  isWebSocketOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Starts the heartbeat interval
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(
      this.sendHeartbeat,
      this.heartbeatTimeoutMs
    );
  }

  /**
   * Stops the heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Sends a heartbeat message to keep the connection alive
   */
  sendHeartbeat() {
    if (this.isWebSocketOpen()) {
      try {
        this.ws.send("ping");
      } catch (error) {
        console.error("Error sending heartbeat:", error);
        this.ws.close(1000, "Heartbeat failed");
      }
    } else {
      this.stopHeartbeat();
    }
  }

  /**
   * Handles presence status changes
   */
  handlePresenceChange(statusData) {
    if (!this.isWebSocketOpen()) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "presence_update",
          ...statusData,
        })
      );
      console.log("Sent presence update:", statusData.status);
    } catch (error) {
      console.error("Error sending presence update:", error);
    }
  }

  /**
   * Handles visibility change events
   */
  handleVisibilityChange() {
    this.isTabActive = !document.hidden;

    // Reset unread count when tab becomes active
    if (this.isTabActive && this.unreadCount > 0) {
      this.unreadCount = 0;
      this.updateTitle();
    }
  }

  /**
   * Switches to a different room using the existing connection
   * @param {string} roomId - The room ID to switch to
   * @returns {Promise} - Resolves when room switch completes
   */
  async switchRoom(roomId) {
    if (!roomId) {
      return Promise.reject(new Error("Invalid room ID"));
    }

    // Don't switch if already in this room
    if (this.currentRoom === roomId && !this.switchingRoom) {
      console.log(`Already in room ${roomId}, no need to switch`);
      return Promise.resolve();
    }

    // If websocket is not open, connect first
    if (!this.isWebSocketOpen()) {
      this.pendingRoomSwitch = roomId;
      try {
        await this.connect();
      } catch (error) {
        return Promise.reject(new Error(`Failed to connect: ${error.message}`));
      }
    }

    // Handle concurrent room switches
    if (this.switchingRoom) {
      console.log(`Already switching rooms, queuing switch to ${roomId}`);
      this.pendingRoomSwitch = roomId;
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.switchingRoom) {
            clearInterval(checkInterval);
            this.switchRoom(roomId).then(resolve).catch(reject);
          }
        }, 300);

        // Add a timeout
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error("Room switch queue timeout"));
        }, 10000);
      });
    }

    this.switchingRoom = true;

    return new Promise((resolve, reject) => {
      // Cancel any existing room switch for this room
      const existingCallback = this.roomSwitchCallbacks.get(roomId);
      if (existingCallback) {
        clearTimeout(existingCallback.timeoutId);
        this.roomSwitchCallbacks.delete(roomId);
      }

      const timeoutId = setTimeout(() => {
        this.roomSwitchCallbacks.delete(roomId);
        this.switchingRoom = false;
        reject(new Error("Room switch timeout"));
      }, this.roomSwitchTimeoutMs);

      this.roomSwitchCallbacks.set(roomId, {
        resolve: () => {
          this.switchingRoom = false;
          resolve();
        },
        reject: (error) => {
          this.switchingRoom = false;
          reject(error);
        },
        timeoutId,
      });

      try {
        // Notify handlers that we're switching rooms
        this.notifyHandlers({
          type: "connection_status",
          status: "switching_room",
          targetRoom: roomId,
        });

        // Send room switch message
        this.ws.send(
          JSON.stringify({
            type: "room_switch",
            room_id: roomId,
          })
        );

        console.log(`Room switch request sent for room ${roomId}`);
      } catch (error) {
        clearTimeout(timeoutId);
        this.roomSwitchCallbacks.delete(roomId);
        this.switchingRoom = false;
        reject(
          new Error(`Failed to send room switch request: ${error.message}`)
        );
      }
    });
  }

  /**
   * Handles incoming WebSocket messages
   */
  handleWebSocketMessage(event) {
    try {
      // Handle ping/pong differently
      if (event.data === "ping" || event.data === "pong") {
        console.debug("Received server heartbeat");
        return;
      }

      const data = JSON.parse(event.data);

      // Handle room switch responses
      if (data.type === "room_switch_success") {
        this.handleRoomSwitchSuccess(data);
      } else if (data.type === "room_switch_error") {
        this.handleRoomSwitchError(data);
      } else if (data.type === "pong") {
        // Handle server heartbeat response
        console.debug("Received heartbeat response");
      } else {
        // Queue regular messages for processing
        this.messageQueue.push(data);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error, event.data);
    }
  }

  /**
   * Handles successful room switch
   */
  handleRoomSwitchSuccess(data) {
    this.currentRoom = data.room_id;
    console.log(`Successfully switched to room ${data.room_id}`);

    const callback = this.roomSwitchCallbacks.get(data.room_id);
    if (callback) {
      clearTimeout(callback.timeoutId);
      this.roomSwitchCallbacks.delete(data.room_id);
      callback.resolve();
    }

    // Notify handlers about successful room switch
    this.notifyHandlers({
      type: "connection_status",
      status: "room_switched",
      room: data.room_id,
    });

    // Process any pending room switch
    if (this.pendingRoomSwitch && this.pendingRoomSwitch !== data.room_id) {
      const nextRoom = this.pendingRoomSwitch;
      this.pendingRoomSwitch = null;
      setTimeout(() => {
        this.switchRoom(nextRoom).catch((error) => {
          console.error("Failed to process next pending room switch:", error);
        });
      }, 100);
    }
  }

  /**
   * Handles room switch errors
   */
  handleRoomSwitchError(data) {
    const roomId = data.room_id || this.pendingRoomSwitch;
    console.error(`Room switch error for room ${roomId}: ${data.message}`);

    const callback = this.roomSwitchCallbacks.get(roomId);
    if (callback) {
      clearTimeout(callback.timeoutId);
      this.roomSwitchCallbacks.delete(roomId);
      callback.reject(new Error(data.message || "Room switch failed"));
    }

    // Notify handlers about failed room switch
    this.notifyHandlers({
      type: "connection_status",
      status: "room_switch_failed",
      room: data.room_id,
      error: data.message,
    });
  }

  /**
   * Processes messages in the message queue
   */
  async processMessageQueue() {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    try {
      const data = this.messageQueue.shift();

      // Check for duplicate messages (using message_id)
      if (data.message_id && this.processedMessages.has(data.message_id)) {
        console.debug("Skipping duplicate message:", data.message_id);
        return;
      }

      // Keep track of processed messages
      if (data.message_id) {
        this.processedMessages.add(data.message_id);
        // Limit size of processed messages set
        if (this.processedMessages.size > 1000) {
          const iterator = this.processedMessages.values();
          this.processedMessages.delete(iterator.next().value);
        }
      }

      // Forward all messages to handlers
      this.notifyHandlers(data);
    } catch (error) {
      console.error("Error processing message:", error);
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Sends a chat message
   * @returns {string} - The temporary message ID
   */
  sendMessage(messageData) {
    if (!this.isWebSocketOpen()) {
      this.handleConnectionLost();
      return null;
    }

    const tempId = this.generateTempId();
    const message = {
      type: "message",
      content: messageData.content,
      message_type: messageData.type || "text",
      room_id: messageData.roomId,
      temp_id: tempId,
      reply_to: messageData.replyTo,
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log("Message sent successfully with tempId:", tempId);
    } catch (err) {
      console.error("Error sending message:", err);
      this.notifyHandlers({
        type: "error",
        message: "Failed to send message. Please try again.",
        temp_id: tempId,
      });
    }

    return tempId;
  }

  /**
   * Handles lost connection scenarios
   */
  handleConnectionLost() {
    console.error("WebSocket not open, cannot send message");
    this.notifyHandlers({
      type: "error",
      message: "Connection lost. Trying to reconnect...",
    });

    // Attempt to reconnect
    this.connect(this.currentRoom).catch((error) => {
      console.error("Failed to reconnect:", error);
    });
  }

  /**
   * Sends user typing status
   */
  sendTypingStatus(isTyping) {
    if (!this.isWebSocketOpen()) return;

    clearTimeout(this.typingDebounceTimer);
    this.typingDebounceTimer = setTimeout(() => {
      try {
        this.ws.send(
          JSON.stringify({
            type: "typing_status",
            is_typing: isTyping,
          })
        );
      } catch (error) {
        console.error("Error sending typing status:", error);
      }
    }, this.typingDebounceMs);
  }

  /**
   * Sends read receipts for messages
   */
  sendReadReceipt(messageIds) {
    if (!this.isWebSocketOpen() || !messageIds || messageIds.length === 0)
      return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "read_receipt",
          message_ids: messageIds,
        })
      );
    } catch (error) {
      console.error("Error sending read receipt:", error);
    }
  }

  /**
   * Sends an emoji reaction to a message
   */
  sendEmojiReaction(messageId, emoji) {
    if (!this.isWebSocketOpen() || !messageId || !emoji) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "add_emoji_reaction",
          message_id: messageId,
          emoji: emoji,
        })
      );
    } catch (error) {
      console.error("Error sending emoji reaction:", error);
    }
  }

  /**
   * Requests an update of rooms from the server
   */
  requestRoomsUpdate() {
    if (!this.isWebSocketOpen()) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "get_rooms",
        })
      );
    } catch (error) {
      console.error("Error requesting rooms update:", error);
    }
  }

  /**
   * Sends a message edit
   */
  sendMessageEdit(messageId, newContent) {
    if (!this.isWebSocketOpen() || !messageId) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "edit_message",
          message_id: messageId,
          content: newContent,
        })
      );
    } catch (error) {
      console.error("Error editing message:", error);
      this.notifyHandlers({
        type: "error",
        message: "Failed to edit message. Please try again.",
      });
    }
  }

  /**
   * Sends a message delete request
   */
  sendMessageDelete(messageId) {
    if (!this.isWebSocketOpen() || !messageId) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "delete_message",
          message_id: messageId,
        })
      );
    } catch (error) {
      console.error("Error deleting message:", error);
      this.notifyHandlers({
        type: "error",
        message: "Failed to delete message. Please try again.",
      });
    }
  }

  /**
   * Adds a message handler
   */
  addMessageHandler(handler) {
    if (typeof handler === "function") {
      this.messageHandlers.add(handler);
    }
  }

  /**
   * Removes a message handler
   */
  removeMessageHandler(handler) {
    this.messageHandlers.delete(handler);
  }

  /**
   * Notifies all handlers with data
   */
  notifyHandlers(data) {
    if (!data || typeof data !== "object") return;

    console.log("Notifying handlers with:", data.type);
    this.messageHandlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error("Error in message handler:", error);
      }
    });
  }

  /**
   * Updates the page title with unread count
   */
  updateTitle() {
    if (!this.originalTitle) {
      this.originalTitle = document.title;
    }

    if (this.unreadCount > 0) {
      const displayCount = this.unreadCount > 99 ? "99+" : this.unreadCount;
      document.title = `(${displayCount}) ${this.originalTitle}`;
    } else {
      document.title = this.originalTitle;
    }
  }

  /**
   * Handles WebSocket close events
   */
  handleWebSocketClose(event) {
    console.log("WebSocket closed:", event.code, event.reason);
    this.stopHeartbeat();
    this.connectionState = "disconnected";

    // Clear any pending room switches
    for (const [_, callback] of this.roomSwitchCallbacks) {
      clearTimeout(callback.timeoutId);
      callback.reject(new Error("Connection closed"));
    }
    this.roomSwitchCallbacks.clear();

    // Normal closure, no need to reconnect
    if (event.code === 1000) {
      console.log("WebSocket closed normally");
    } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.error("Max reconnection attempts reached");
    }

    this.notifyHandlers({
      type: "connection_status",
      status: "disconnected",
      willReconnect: this.reconnectAttempts < this.maxReconnectAttempts,
    });
  }

  /**
   * Schedules a reconnection attempt with exponential backoff
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    console.log(
      `WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      if (this.connectionState !== "connecting") {
        this.connect(this.currentRoom).catch((error) => {
          console.error("Reconnection failed:", error);
        });
      }
    }, delay);
  }

  /**
   * Generates a temporary message ID
   */
  generateTempId() {
    return `temp-${Date.now()}-${++this.messageCounter}`;
  }

  /**
   * Cleans up resources
   */
  cleanup() {
    // Clear intervals and timeouts
    this.stopHeartbeat();

    if (this.queueProcessInterval) {
      clearInterval(this.queueProcessInterval);
      this.queueProcessInterval = null;
    }

    if (this.typingDebounceTimer) {
      clearTimeout(this.typingDebounceTimer);
      this.typingDebounceTimer = null;
    }

    // Clear timeouts from room switching
    for (const [_, callback] of this.roomSwitchCallbacks) {
      clearTimeout(callback.timeoutId);
    }
    this.roomSwitchCallbacks.clear();

    // Remove event listeners
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );

    // Close WebSocket
    this.closeExistingConnection();

    // Reset state
    this.currentRoom = null;
    this.pendingRoomSwitch = null;
    this.messageHandlers.clear();
    this.messageQueue = [];
    WebSocketManager.instance = null;
  }
}

export default WebSocketManager;
