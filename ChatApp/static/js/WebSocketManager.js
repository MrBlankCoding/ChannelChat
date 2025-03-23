import PresenceManager from "./PresenceManager.js";
import { getAuthToken } from "./auth.js";

/**
 * Constants for WebSocketManager configuration
 */
const WS_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5,
  INITIAL_RECONNECT_DELAY_MS: 1000,
  CONNECTION_TIMEOUT_MS: 10000,
  HEARTBEAT_INTERVAL_MS: 30000,
  ROOM_SWITCH_TIMEOUT_MS: 5000,
  TYPING_DEBOUNCE_MS: 300,
  MESSAGE_QUEUE_PROCESS_INTERVAL_MS: 50,
  MAX_PROCESSED_MESSAGES: 1000
};

/**
 * WebSocket connection states
 */
const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  BASE_VIEW: 'base_view'
};

/**
 * Message types
 */
const MESSAGE_TYPES = {
  TEXT: 'text',
  MESSAGE: 'message',
  TYPING_STATUS: 'typing_status',
  READ_RECEIPT: 'read_receipt',
  PRESENCE_UPDATE: 'presence_update',
  ROOM_SWITCH: 'room_switch',
  ROOM_SWITCH_SUCCESS: 'room_switch_success',
  ROOM_SWITCH_ERROR: 'room_switch_error',
  GET_ROOMS: 'get_rooms',
  EDIT_MESSAGE: 'edit_message',
  DELETE_MESSAGE: 'delete_message',
  ADD_EMOJI_REACTION: 'add_emoji_reaction',
  CONNECTION_STATUS: 'connection_status',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong'
};

/**
 * Manages WebSocket connections and message handling
 */
class WebSocketManager {
  constructor() {
    if (WebSocketManager.instance) {
      return WebSocketManager.instance;
    }
    WebSocketManager.instance = this;

    this._initializeProperties();
    this._bindMethods();
    this._setupEventListeners();
    this._startMessageQueueProcessing();
  }

  /**
   * Returns the singleton instance of WebSocketManager
   */
  static getInstance() {
    return WebSocketManager.instance || new WebSocketManager();
  }

  /**
   * Initialize instance properties
   * @private
   */
  _initializeProperties() {
    // Connection properties
    this.ws = null;
    this.reconnectAttempts = 0;
    this.connectionState = CONNECTION_STATES.DISCONNECTED;
    this.connectionPromise = null;
    this.heartbeatInterval = null;
    this.originalTitle = document.title;

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

    // Room switching
    this.roomSwitchCallbacks = new Map();
    this.switchingRoom = false;

    // Tab focus tracking
    this.isTabActive = !document.hidden;
    this.unreadCount = 0;

    // Initialize PresenceManager
    this.presenceManager = PresenceManager.getInstance();
    this.presenceManager.onStatusChange(this.handlePresenceChange.bind(this));
  }

  /**
   * Bind methods to preserve 'this' context
   * @private
   */
  _bindMethods() {
    this.handleWebSocketMessage = this.handleWebSocketMessage.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.processMessageQueue = this.processMessageQueue.bind(this);
    this.sendHeartbeat = this.sendHeartbeat.bind(this);
  }

  /**
   * Set up event listeners
   * @private
   */
  _setupEventListeners() {
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  /**
   * Start message queue processing
   * @private
   */
  _startMessageQueueProcessing() {
    this.queueProcessInterval = setInterval(
      this.processMessageQueue,
      WS_CONFIG.MESSAGE_QUEUE_PROCESS_INTERVAL_MS
    );
  }

  /**
   * Sets the current user
   * @param {Object} user - User object
   */
  setCurrentUser(user) {
    this.currentUser = user;
  }

  /**
   * Checks if we're on the base chat route
   * @returns {boolean} - True if on base chat route
   */
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
      this.connectionState = CONNECTION_STATES.BASE_VIEW;
      return Promise.resolve();
    }

    // Prevent multiple simultaneous connection attempts
    if (this.connectionState === CONNECTION_STATES.CONNECTING) {
      return this.connectionPromise;
    }

    // If already connected and not switching rooms, return
    if (
      this.connectionState === CONNECTION_STATES.CONNECTED &&
      this.isWebSocketOpen() &&
      !path
    ) {
      return Promise.resolve();
    }

    // We must always have a roomId when establishing a connection
    if (!path) {
      const error = new Error("Room ID is required for WebSocket connection");
      console.error(error.message);
      return Promise.reject(error);
    }

    this.connectionState = CONNECTION_STATES.CONNECTING;

    // Create a new connection promise
    this.connectionPromise = this._createConnection(path);
    return this.connectionPromise;
  }

  /**
   * Creates a new WebSocket connection
   * @param {string} path - Path to connect to
   * @returns {Promise} - Connection promise
   * @private
   */
  async _createConnection(path) {
    try {
      const token = await getAuthToken();

      if (!token) {
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        throw new Error("No authentication token available");
      }

      // Close existing connection if it exists
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        this._closeExistingConnection();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const baseUrl = `${protocol}//${window.location.host}/ws/${token}`;
      const wsUrl = `${baseUrl}/${path}`;

      console.log(`Connecting to WebSocket at: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      return new Promise((resolve, reject) => {
        // Set up connection timeout
        const connectionTimeout = setTimeout(() => {
          if (this.connectionState !== CONNECTION_STATES.CONNECTED) {
            this.ws.close();
            this.connectionState = CONNECTION_STATES.DISCONNECTED;
            reject(new Error("Connection timeout"));
          }
        }, WS_CONFIG.CONNECTION_TIMEOUT_MS);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          console.log("WebSocket connected to room:", path);
          this.connectionState = CONNECTION_STATES.CONNECTED;
          this.currentRoom = path;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._notifyHandlers({
            type: MESSAGE_TYPES.CONNECTION_STATUS,
            status: "connected",
            room: path,
          });
          resolve();
        };

        this.ws.onclose = this._handleWebSocketClose.bind(this);
        this.ws.onerror = this._handleWebSocketError.bind(this);
        this.ws.onmessage = this.handleWebSocketMessage;
      });
    } catch (error) {
      this.connectionState = CONNECTION_STATES.DISCONNECTED;
      console.error("Error connecting to WebSocket:", error);
      throw error;
    }
  }

  /**
   * Closes the existing WebSocket connection
   * @private
   */
  _closeExistingConnection() {
    if (!this.ws) return;

    console.log("Closing existing WebSocket connection");
    this._stopHeartbeat();

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
   * @private
   */
  _handleWebSocketError(event) {
    console.error("WebSocket error:", event);
    this._notifyHandlers({
      type: MESSAGE_TYPES.CONNECTION_STATUS,
      status: "error",
      error: "Connection error",
    });
  }

  /**
   * Checks if the WebSocket is currently open
   * @returns {boolean} - True if WebSocket is open
   */
  isWebSocketOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Starts the heartbeat interval
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(
      this.sendHeartbeat,
      WS_CONFIG.HEARTBEAT_INTERVAL_MS
    );
  }

  /**
   * Stops the heartbeat interval
   * @private
   */
  _stopHeartbeat() {
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
        this.ws.send(MESSAGE_TYPES.PING);
      } catch (error) {
        console.error("Error sending heartbeat:", error);
        this.ws.close(1000, "Heartbeat failed");
      }
    } else {
      this._stopHeartbeat();
    }
  }

  /**
   * Handles presence status changes
   * @param {Object} statusData - Presence status data
   */
  handlePresenceChange(statusData) {
    if (!this.isWebSocketOpen()) return;

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.PRESENCE_UPDATE,
        ...statusData,
      });
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
      this._updateTitle();
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
        await this.connect(roomId);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(new Error(`Failed to connect: ${error.message}`));
      }
    }

    // Handle concurrent room switches
    if (this.switchingRoom) {
      return this._handleConcurrentRoomSwitch(roomId);
    }

    return this._performRoomSwitch(roomId);
  }

  /**
   * Handles concurrent room switch requests
   * @param {string} roomId - The room ID to switch to
   * @returns {Promise} - Room switch promise
   * @private
   */
  _handleConcurrentRoomSwitch(roomId) {
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
      }, WS_CONFIG.ROOM_SWITCH_TIMEOUT_MS * 2);
    });
  }

  /**
   * Performs the actual room switch
   * @param {string} roomId - The room ID to switch to
   * @returns {Promise} - Room switch promise
   * @private
   */
  _performRoomSwitch(roomId) {
    this.switchingRoom = true;

    return new Promise((resolve, reject) => {
      // Cancel any existing room switch for this room
      this._cleanupExistingRoomSwitch(roomId);

      const timeoutId = setTimeout(() => {
        this.roomSwitchCallbacks.delete(roomId);
        this.switchingRoom = false;
        reject(new Error("Room switch timeout"));
      }, WS_CONFIG.ROOM_SWITCH_TIMEOUT_MS);

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
        this._notifyHandlers({
          type: MESSAGE_TYPES.CONNECTION_STATUS,
          status: "switching_room",
          targetRoom: roomId,
        });

        // Send room switch message
        this._sendMessage({
          type: MESSAGE_TYPES.ROOM_SWITCH,
          room_id: roomId,
        });

        console.log(`Room switch request sent for room ${roomId}`);
      } catch (error) {
        this._cleanupRoomSwitch(roomId, timeoutId);
        reject(
          new Error(`Failed to send room switch request: ${error.message}`)
        );
      }
    });
  }

  /**
   * Cleans up an existing room switch
   * @param {string} roomId - Room ID
   * @private
   */
  _cleanupExistingRoomSwitch(roomId) {
    const existingCallback = this.roomSwitchCallbacks.get(roomId);
    if (existingCallback) {
      clearTimeout(existingCallback.timeoutId);
      this.roomSwitchCallbacks.delete(roomId);
    }
  }

  /**
   * Cleans up a room switch
   * @param {string} roomId - Room ID
   * @param {number} timeoutId - Timeout ID
   * @private
   */
  _cleanupRoomSwitch(roomId, timeoutId) {
    clearTimeout(timeoutId);
    this.roomSwitchCallbacks.delete(roomId);
    this.switchingRoom = false;
  }

  /**
   * Handles incoming WebSocket messages
   * @param {MessageEvent} event - WebSocket message event
   */
  handleWebSocketMessage(event) {
    try {
      // Handle ping/pong differently
      if (
        event.data === MESSAGE_TYPES.PING ||
        event.data === MESSAGE_TYPES.PONG
      ) {
        console.debug("Received server heartbeat");
        return;
      }

      const data = JSON.parse(event.data);

      // Handle room switch responses
      if (data.type === MESSAGE_TYPES.ROOM_SWITCH_SUCCESS) {
        this._handleRoomSwitchSuccess(data);
      } else if (data.type === MESSAGE_TYPES.ROOM_SWITCH_ERROR) {
        this._handleRoomSwitchError(data);
      } else if (data.type === MESSAGE_TYPES.PONG) {
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
   * @param {Object} data - Room switch success data
   * @private
   */
  _handleRoomSwitchSuccess(data) {
    this.currentRoom = data.room_id;
    console.log(`Successfully switched to room ${data.room_id}`);

    const callback = this.roomSwitchCallbacks.get(data.room_id);
    if (callback) {
      clearTimeout(callback.timeoutId);
      this.roomSwitchCallbacks.delete(data.room_id);
      callback.resolve();
    }

    // Notify handlers about successful room switch
    this._notifyHandlers({
      type: MESSAGE_TYPES.CONNECTION_STATUS,
      status: "room_switched",
      room: data.room_id,
    });

    this._processPendingRoomSwitch(data.room_id);
  }

  /**
   * Process pending room switch if any
   * @param {string} currentRoomId - Current room ID
   * @private
   */
  _processPendingRoomSwitch(currentRoomId) {
    // Process any pending room switch
    if (this.pendingRoomSwitch && this.pendingRoomSwitch !== currentRoomId) {
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
   * @param {Object} data - Room switch error data
   * @private
   */
  _handleRoomSwitchError(data) {
    const roomId = data.room_id || this.pendingRoomSwitch;
    console.error(`Room switch error for room ${roomId}: ${data.message}`);

    const callback = this.roomSwitchCallbacks.get(roomId);
    if (callback) {
      clearTimeout(callback.timeoutId);
      this.roomSwitchCallbacks.delete(roomId);
      callback.reject(new Error(data.message || "Room switch failed"));
    }

    // Notify handlers about failed room switch
    this._notifyHandlers({
      type: MESSAGE_TYPES.CONNECTION_STATUS,
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
        this._trackProcessedMessage(data.message_id);
      }

      // Forward all messages to handlers
      this._notifyHandlers(data);
    } catch (error) {
      console.error("Error processing message:", error);
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Tracks processed messages and limits set size
   * @param {string} messageId - Message ID to track
   * @private
   */
  _trackProcessedMessage(messageId) {
    this.processedMessages.add(messageId);

    // Limit size of processed messages set
    if (this.processedMessages.size > WS_CONFIG.MAX_PROCESSED_MESSAGES) {
      const iterator = this.processedMessages.values();
      this.processedMessages.delete(iterator.next().value);
    }
  }

  /**
   * Generic method to send a message through WebSocket
   * @param {Object} payload - Message payload
   * @private
   */
  _sendMessage(payload) {
    if (!this.isWebSocketOpen()) {
      throw new Error("WebSocket not open");
    }

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sends a chat message
   * @param {Object} messageData - Message data
   * @returns {string} - The temporary message ID
   */
  sendMessage(messageData) {
    if (!this.isWebSocketOpen()) {
      this._handleConnectionLost();
      return null;
    }

    const tempId = this._generateTempId();

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.MESSAGE,
        content: messageData.content,
        message_type: messageData.type || MESSAGE_TYPES.TEXT,
        room_id: messageData.roomId,
        temp_id: tempId,
        reply_to: messageData.replyTo,
      });

      console.log("Message sent successfully with tempId:", tempId);
    } catch (err) {
      console.error("Error sending message:", err);
      this._notifyHandlers({
        type: MESSAGE_TYPES.ERROR,
        message: "Failed to send message. Please try again.",
        temp_id: tempId,
      });
    }

    return tempId;
  }

  /**
   * Handles lost connection scenarios
   * @private
   */
  _handleConnectionLost() {
    console.error("WebSocket not open, cannot send message");
    this._notifyHandlers({
      type: MESSAGE_TYPES.ERROR,
      message: "Connection lost. Trying to reconnect...",
    });

    // Attempt to reconnect
    this.connect(this.currentRoom).catch((error) => {
      console.error("Failed to reconnect:", error);
    });
  }

  /**
   * Sends user typing status
   * @param {boolean} isTyping - Whether user is typing
   */
  sendTypingStatus(isTyping) {
    if (!this.isWebSocketOpen()) return;

    clearTimeout(this.typingDebounceTimer);
    this.typingDebounceTimer = setTimeout(() => {
      try {
        this._sendMessage({
          type: MESSAGE_TYPES.TYPING_STATUS,
          is_typing: isTyping,
        });
      } catch (error) {
        console.error("Error sending typing status:", error);
      }
    }, WS_CONFIG.TYPING_DEBOUNCE_MS);
  }

  /**
   * Sends read receipts for messages
   * @param {Array<string>} messageIds - Message IDs to mark as read
   */
  sendReadReceipt(messageIds) {
    if (!this.isWebSocketOpen() || !messageIds || messageIds.length === 0)
      return;

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.READ_RECEIPT,
        message_ids: messageIds,
      });
    } catch (error) {
      console.error("Error sending read receipt:", error);
    }
  }

  /**
   * Sends an emoji reaction to a message
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji to react with
   */
  sendEmojiReaction(messageId, emoji) {
    if (!this.isWebSocketOpen() || !messageId || !emoji) return;

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.ADD_EMOJI_REACTION,
        message_id: messageId,
        emoji: emoji,
      });
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
      this._sendMessage({
        type: MESSAGE_TYPES.GET_ROOMS,
      });
    } catch (error) {
      console.error("Error requesting rooms update:", error);
    }
  }

  /**
   * Sends a message edit
   * @param {string} messageId - ID of the message to edit
   * @param {string} newContent - Updated content for the message
   */
  sendMessageEdit(messageId, newContent) {
    if (!this.isWebSocketOpen() || !messageId) return;

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.EDIT_MESSAGE,
        message_id: messageId,
        content: newContent,
      });
    } catch (error) {
      console.error("Error editing message:", error);
      this._notifyHandlers({
        type: MESSAGE_TYPES.ERROR,
        message: "Failed to edit message. Please try again.",
      });
    }
  }

  /**
   * Sends a message delete request
   * @param {string} messageId - ID of the message to delete
   */
  sendMessageDelete(messageId) {
    if (!this.isWebSocketOpen() || !messageId) return;

    try {
      this._sendMessage({
        type: MESSAGE_TYPES.DELETE_MESSAGE,
        message_id: messageId,
      });
    } catch (error) {
      console.error("Error deleting message:", error);
      this._notifyHandlers({
        type: MESSAGE_TYPES.ERROR,
        message: "Failed to delete message. Please try again.",
      });
    }
  }

  /**
   * Adds a message handler
   * @param {Function} handler - Function to handle messages
   */
  addMessageHandler(handler) {
    if (typeof handler === "function") {
      this.messageHandlers.add(handler);
    }
  }

  /**
   * Removes a message handler
   * @param {Function} handler - Handler to remove
   */
  removeMessageHandler(handler) {
    this.messageHandlers.delete(handler);
  }

  /**
   * Notifies all handlers with data
   * @param {Object} data - Data to pass to handlers
   * @private
   */
  _notifyHandlers(data) {
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
   * @private
   */
  _updateTitle() {
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
   * @param {CloseEvent} event - WebSocket close event
   * @private
   */
  _handleWebSocketClose(event) {
    console.log("WebSocket closed:", event.code, event.reason);
    this._stopHeartbeat();
    this.connectionState = CONNECTION_STATES.DISCONNECTED;

    // Clear any pending room switches
    for (const [_, callback] of this.roomSwitchCallbacks) {
      clearTimeout(callback.timeoutId);
      callback.reject(new Error("Connection closed"));
    }
    this.roomSwitchCallbacks.clear();
    this.switchingRoom = false;

    // Normal closure, no need to reconnect
    if (event.code === 1000) {
      console.log("WebSocket closed normally");
    } else if (this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      this._scheduleReconnect();
    } else {
      console.error("Max reconnection attempts reached");
    }

    this._notifyHandlers({
      type: MESSAGE_TYPES.CONNECTION_STATUS,
      status: "disconnected",
      willReconnect: this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS,
    });
  }

  /**
   * Schedules a reconnection attempt with exponential backoff
   * @private
   */
  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      WS_CONFIG.INITIAL_RECONNECT_DELAY_MS *
        Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    console.log(
      `WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${WS_CONFIG.MAX_RECONNECT_ATTEMPTS})`
    );

    setTimeout(() => {
      if (this.connectionState !== CONNECTION_STATES.CONNECTING) {
        this.connect(this.currentRoom).catch((error) => {
          console.error("Reconnection failed:", error);
        });
      }
    }, delay);
  }

  /**
   * Generates a temporary message ID
   * @returns {string} - Temporary message ID
   * @private
   */
  _generateTempId() {
    return `temp-${Date.now()}-${++this.messageCounter}`;
  }

  /**
   * Cleans up resources and prepares for object destruction
   */
  cleanup() {
    // Clear intervals and timeouts
    this._stopHeartbeat();

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
    this._closeExistingConnection();

    // Reset state
    this.currentRoom = null;
    this.pendingRoomSwitch = null;
    this.messageHandlers.clear();
    this.messageQueue = [];
    WebSocketManager.instance = null;
  }
}

export default WebSocketManager;