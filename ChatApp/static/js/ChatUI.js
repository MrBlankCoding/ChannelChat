import WebSocketManager from "./WebSocketManager.js";
import ImageGallery from "./ImageGallery.js";
import MessageRenderer from "./MessageRenderer.js";
import ChatManager from "./ChatManager.js";

class ChatUI {
  constructor(options = {}) {
    // DOM Elements
    this.elements = {
      messagesContainer: document.querySelector("#messagesContainer"),
      messageContainer: document.querySelector("#messages"),
      loadingSpinner: document.querySelector("#loadingSpinner"),
      messageForm: document.querySelector("#messageForm"),
      messageInput: document.querySelector("#messageInput"),
      roomNameElement: document.querySelector("#roomName"),
      roomCodeElement: document.querySelector("#roomCode"),
      imageInput: document.querySelector("#imageInput"),
      typingIndicator: null,
    };

    this.inputWrapper =
      this.elements.messageForm.querySelector(".input-wrapper");

    // Services & Utilities
    this.services = {
      wsManager: WebSocketManager.getInstance(),
      chatManager: ChatManager.instance,
      messageRenderer: new MessageRenderer(),
      imageGallery: new ImageGallery(),
    };

    // State
    this.state = {
      isScrolledToBottom: true,
      lastMessageUsername: null,
      replyingTo: null,
      currentUsername: null,
      typingUsers: new Set(),
      typingTimeout: null,
    };

    this.loadingMoreIndicator = this.createLoadingMoreIndicator();

    // Initialize UI
    this.init();
  }

  // Initialization methods
  init() {
    this.setupEventListeners();
    this.setupTypingIndicator();
    this.setupImageUpload();
    this.createScrollIndicator();
  }

  setupEventListeners() {
    const { messageContainer, messageForm } = this.elements;

    // Scroll handling
    messageContainer.addEventListener("scroll", this.handleScroll.bind(this));

    // Message form submission
    messageForm.addEventListener("submit", this.handleMessageSubmit.bind(this));

    // Image gallery handling
    messageContainer.addEventListener(
      "click",
      this.handleImageClick.bind(this)
    );

    // Message actions
    this.setupMessageActionListeners();

    // Input auto-resize
    this.setupAutoResizeInput();
  }

  setupAutoResizeInput() {
    const { messageInput } = this.elements;

    messageInput.addEventListener("input", () => {
      messageInput.style.height = "auto";
      messageInput.style.height = `${messageInput.scrollHeight}px`;
    });
  }

  setupMessageActionListeners() {
    const { messageContainer } = this.elements;

    // Delegate event handlers for message actions
    messageContainer.addEventListener("click", (e) => {
      // Handle reactions
      if (
        e.target.closest(".reaction-btn") ||
        e.target.closest(".add-reaction-btn")
      ) {
        const messageElement = e.target.closest(".message");
        e.stopPropagation();
        this.showEmojiPicker(messageElement);
        return;
      }

      // Handle message manipulation buttons
      const actionButton = e.target.closest(
        ".reply-message-btn, .edit-message-btn, .delete-message-btn, .cancel-reply-btn"
      );
      if (!actionButton) return;

      const messageElement = actionButton.closest(".message");

      if (actionButton.classList.contains("reply-message-btn")) {
        this.setupReplyMode(messageElement);
      } else if (actionButton.classList.contains("cancel-reply-btn")) {
        this.exitReplyMode();
      } else if (actionButton.classList.contains("edit-message-btn")) {
        this.setupEditMode(messageElement);
      } else if (actionButton.classList.contains("delete-message-btn")) {
        this.handleDeleteMessage(messageElement);
      }
    });
  }

  handleDeleteMessage(messageElement) {
    const messageId = messageElement.dataset.messageId;

    if (confirm("Are you sure you want to delete this message?")) {
      this.services.chatManager.deleteMessage(messageId);
    }
  }

  setupTypingIndicator() {
    const { messageContainer, messageInput } = this.elements;
    const { chatManager } = this.services;

    // Create typing indicator element
    const typingContainer = document.createElement("div");
    typingContainer.id = "typingIndicator";
    typingContainer.className =
      "hidden px-4 py-2 text-sm text-slate-500 dark:text-slate-400 italic transition-opacity duration-300";
    messageContainer.parentNode.insertBefore(
      typingContainer,
      messageContainer.nextSibling
    );

    this.elements.typingIndicator = typingContainer;

    // Handle typing events
    messageInput.addEventListener("input", () => {
      if (chatManager) {
        clearTimeout(this.state.typingTimeout);
        chatManager.sendTypingStatus(true);

        this.state.typingTimeout = setTimeout(() => {
          chatManager.sendTypingStatus(false);
        }, 2000);
      }
    });
  }

  setupImageUpload() {
    const uploadButton = document.getElementById("imageUploadButton");
    const { imageInput } = this.elements;
    const { chatManager } = this.services;

    if (!uploadButton) {
      console.error("Image upload button not found.");
      return;
    }

    uploadButton.addEventListener("click", () => imageInput.click());

    imageInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        chatManager.handleImageUpload(e.target.files);
        e.target.value = "";
      }
    });
  }

  createScrollIndicator() {
    const { messagesContainer } = this.elements;

    const indicator = document.createElement("button");
    indicator.id = "scrollIndicator";
    indicator.className =
      "hidden fixed bottom-24 right-8 bg-blue-500 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg hover:bg-blue-600 transition-all transform hover:scale-105 z-10";
    indicator.innerHTML = '<i class="fas fa-arrow-down"></i>';
    indicator.addEventListener("click", () => this.scrollToBottom(true));

    messagesContainer.appendChild(indicator);
  }

  // Event handlers
  handleScroll() {
    const { messageContainer } = this.elements;

    // Check if we're at the top for loading more messages
    if (messageContainer.scrollTop < 50) {
      this.services.chatManager.loadMoreMessages();
    }

    // Update scroll state
    this.state.isScrolledToBottom = this.isNearBottom();
    this.updateScrollIndicator();
  }

  handleImageClick(e) {
    const clickedImage = e.target.closest(".message-image-container img");
    if (clickedImage) {
      e.preventDefault();
      this.services.imageGallery.show(clickedImage.src);
    }
  }

  handleMessageSubmit(e) {
    e.preventDefault();
    const { messageInput } = this.elements;
    const { wsManager, chatManager } = this.services;
    const { replyingTo, currentUsername } = this.state;

    const content = messageInput.value.trim();

    if (content && wsManager.isWebSocketOpen()) {
      const messageData = {
        content,
        username: currentUsername,
        timestamp: new Date().toISOString(),
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              content: replyingTo.content,
              username: replyingTo.username,
            }
          : null,
      };

      chatManager.sendMessage(messageData);
      messageInput.value = "";
      messageInput.style.height = "auto";
      this.exitReplyMode();
    }
  }

  // UI state management
  setCurrentUser(user) {
    this.state.currentUsername = user.username;
    this.services.messageRenderer.setCurrentUser(user);
  }

  setChatManager(chatManager) {
    this.services.chatManager = chatManager;
  }

  setLoading(isLoading) {
    const { loadingSpinner, messagesContainer, messageForm } = this.elements;

    loadingSpinner.classList.toggle("hidden", !isLoading);
    messagesContainer.classList.toggle("hidden", isLoading);
    messageForm.classList.toggle("hidden", isLoading);
  }

  enableForm(isEnabled) {
    const { messageInput, messageForm } = this.elements;

    messageInput.disabled = !isEnabled;
    messageForm.querySelector("button").disabled = !isEnabled;
  }

  updateRoomInfo(room) {
    const { roomNameElement, roomCodeElement } = this.elements;

    roomNameElement.textContent = room.name;
    roomCodeElement.setAttribute("data-code", room.code);
    document.title = `Channel Chat - ${room.name}`;

    // Add room joining animation
    roomNameElement.classList.add("pulse-animation");
    setTimeout(() => roomNameElement.classList.remove("pulse-animation"), 1000);
  }

  // Scroll handling
  isNearBottom() {
    const { messageContainer } = this.elements;
    const threshold = 100;

    return (
      messageContainer.scrollHeight -
        messageContainer.scrollTop -
        messageContainer.clientHeight <
      threshold
    );
  }

  scrollToBottom(force = false) {
    const { messageContainer } = this.elements;

    if ((force || this.state.isScrolledToBottom) && messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
      this.state.isScrolledToBottom = true;
      this.updateScrollIndicator();
    }
  }

  updateScrollIndicator() {
    const indicator = document.getElementById("scrollIndicator");
    if (indicator) {
      if (this.state.isScrolledToBottom) {
        indicator.classList.add("hidden");
      } else {
        indicator.classList.remove("hidden");
        indicator.classList.add("bounce-animation");
        setTimeout(() => indicator.classList.remove("bounce-animation"), 1000);
      }
    }
  }

  // Message operations
  clearMessages() {
    const { messageContainer } = this.elements;
    messageContainer.innerHTML = "";
  }

  normalizeMessage(message) {
    // Ensure consistent message structure
    return {
      id: message.id || `temp-${Date.now()}`,
      username: message.username || "Anonymous",
      content: message.content || "",
      timestamp: message.timestamp || new Date().toISOString(),
      type: message.type || "text",
      status: message.status || "sent",
      edited: !!message.edited,
      read_by: Array.isArray(message.read_by) ? message.read_by : [],

      // Handle reply data if present
      reply_to: message.reply_to
        ? {
            message_id: message.reply_to.message_id || message.reply_to.id,
            content: message.reply_to.content || "",
            username: message.reply_to.username || "Anonymous",
          }
        : message.replyTo
        ? {
            message_id: message.replyTo.id,
            content: message.replyTo.content || "",
            username: message.replyTo.username || "Anonymous",
          }
        : null,

      // Handle reactions
      reactions: message.reactions || [],

      // Handle image data if present
      image_url: message.image_url || message.imageUrl || null,
    };
  }

  async displayMessages(messages) {
    const { messageContainer } = this.elements;
    const { messageRenderer } = this.services;

    if (!messageContainer) return;

    messageContainer.innerHTML = "";
    this.state.lastMessageUsername = null;

    const fragment = document.createDocumentFragment();

    for (const message of messages) {
      const processedMessage = this.normalizeMessage(message);
      const showHeader =
        processedMessage.username !== this.state.lastMessageUsername;

      const messageElement = await messageRenderer.createMessageElement(
        processedMessage,
        showHeader
      );

      fragment.appendChild(messageElement);
      this.state.lastMessageUsername = processedMessage.username;
    }

    messageContainer.appendChild(fragment);
    this.scrollToBottom();
  }

  async prependMessages(messages) {
    const { messageContainer } = this.elements;
    const { messageRenderer } = this.services;

    if (!messageContainer) return;

    const scrollBottom =
      messageContainer.scrollHeight - messageContainer.scrollTop;
    const tempLastMessageUsername = this.state.lastMessageUsername;
    this.state.lastMessageUsername = null;

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();

    for (const message of messages.reverse()) {
      const processedMessage = this.normalizeMessage(message);
      const showHeader =
        processedMessage.username !== this.state.lastMessageUsername;

      const messageElement = await messageRenderer.createMessageElement(
        processedMessage,
        showHeader
      );

      fragment.appendChild(messageElement);
      this.state.lastMessageUsername = processedMessage.username;
    }

    const insertAfter =
      this.loadingMoreIndicator?.parentElement === messageContainer
        ? this.loadingMoreIndicator.nextSibling
        : messageContainer.firstChild;

    messageContainer.insertBefore(fragment, insertAfter);
    this.state.lastMessageUsername = tempLastMessageUsername;

    // Maintain scroll position
    messageContainer.scrollTop = messageContainer.scrollHeight - scrollBottom;
    this.showLoadingMore(false);
  }

  async appendMessage(message) {
    const { messageContainer } = this.elements;
    const { messageRenderer } = this.services;

    // Check for existing message with the same ID
    if (message.id) {
      const existingMessage = messageContainer.querySelector(
        `.message[data-message-id="${message.id}"]`
      );

      if (existingMessage) {
        if (message.read_by) {
          this.updateMessageReadStatus(message.id, message.read_by);
        }
        return;
      }
    }

    // Check for temporary message that might be a duplicate
    // Look for temporary messages with matching content and username
    if (!message.id.startsWith("temp-")) {
      const tempMessages = Array.from(
        messageContainer.querySelectorAll('.message[data-message-id^="temp-"]')
      );

      const duplicateTempMessage = tempMessages.find((tempMsg) => {
        const tempContent = tempMsg
          .querySelector(".message-content")
          ?.textContent?.trim();
        const tempUsername = tempMsg.getAttribute("data-username");

        return (
          tempUsername === message.username && tempContent === message.content
        );
      });

      if (duplicateTempMessage) {
        // Replace the temporary message with the confirmed one
        duplicateTempMessage.setAttribute("data-message-id", message.id);

        // Update read status if needed
        if (message.read_by) {
          this.updateMessageReadStatus(message.id, message.read_by);
        }

        return;
      }
    }

    const tempId = message.id || `temp-${Date.now()}`;
    const shouldScroll = this.isNearBottom();
    const showHeader = message.username !== this.state.lastMessageUsername;

    // Process reply data
    const reply_to = message.reply_to
      ? {
          message_id: message.reply_to.id || message.reply_to.message_id,
          content: message.reply_to.content,
          username: message.reply_to.username,
        }
      : null;

    // Create message element
    const messageElement = await messageRenderer.createMessageElement(
      {
        ...message,
        id: tempId,
        reply_to,
      },
      showHeader
    );

    // Add slide-in animation
    messageElement.classList.add("slide-in-animation");

    messageContainer.appendChild(messageElement);
    this.state.lastMessageUsername = message.username;

    if (shouldScroll || message.username === this.state.currentUsername) {
      this.scrollToBottom(true);
    } else {
      // Show new message notification
      this.showNewMessageNotification(message.username);
    }
  }

  showNewMessageNotification(username) {
    const notification = document.createElement("div");
    notification.className =
      "fixed bottom-16 right-8 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 notification-animation";
    notification.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fas fa-comment-dots"></i>
        <span>New message from ${username}</span>
      </div>
    `;

    notification.addEventListener("click", () => {
      this.scrollToBottom(true);
      notification.remove();
    });

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add("fade-out");
      notification.addEventListener("animationend", () =>
        notification.remove()
      );
    }, 3000);
  }

  // Message editing & reactions
  setupEditMode(messageElement) {
    const contentDiv = messageElement.querySelector(".message-content");
    const currentContent = contentDiv.textContent
      .replace("(edited)", "")
      .trim();

    const editForm = document.createElement("form");
    editForm.className = "edit-form flex gap-2";
    editForm.innerHTML = `
      <input type="text" class="flex-grow px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700" 
             value="${this.escapeHtml(currentContent)}">
      <div class="flex gap-1">
        <button type="submit" class="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
            <i class="fas fa-check"></i>
        </button>
        <button type="button" class="cancel-edit text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
            <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    // Add smooth transition
    contentDiv.style.opacity = 0;
    setTimeout(() => {
      contentDiv.replaceWith(editForm);
      editForm.style.opacity = 0;
      setTimeout(() => {
        editForm.style.opacity = 1;
      }, 10);
    }, 150);

    const input = editForm.querySelector("input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newContent = input.value.trim();
      if (newContent && newContent !== currentContent) {
        const messageId = messageElement.dataset.messageId;
        await this.services.chatManager.editMessage(messageId, newContent);
      }
      this.exitEditMode(messageElement, newContent || currentContent);
    });

    editForm.querySelector(".cancel-edit").addEventListener("click", () => {
      this.exitEditMode(messageElement, currentContent);
    });
  }

  exitEditMode(messageElement, content) {
    const editForm = messageElement.querySelector(".edit-form");
    const contentDiv = document.createElement("div");
    contentDiv.className = "text-sm message-content";
    contentDiv.textContent = content;

    // Animation for smooth transition
    editForm.style.opacity = 0;
    setTimeout(() => {
      editForm.replaceWith(contentDiv);
      contentDiv.style.opacity = 0;
      setTimeout(() => {
        contentDiv.style.opacity = 1;
      }, 10);
    }, 150);
  }

  updateMessage(messageId, content, edited = true) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );

    if (messageEl) {
      const contentDiv = messageEl.querySelector(".message-content");

      // Add animation
      contentDiv.classList.add("fade-update");

      setTimeout(() => {
        contentDiv.textContent = content;

        if (edited && !contentDiv.textContent.includes("(edited)")) {
          contentDiv.insertAdjacentHTML(
            "beforeend",
            '<span class="text-xs text-slate-400 ml-2 italic">(edited)</span>'
          );
        }

        setTimeout(() => {
          contentDiv.classList.remove("fade-update");
        }, 300);
      }, 300);
    }
  }

  deleteMessage(messageId) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );

    if (messageEl) {
      // Improved animation
      messageEl.classList.add("message-delete-animation");
      messageEl.addEventListener("animationend", () => messageEl.remove());
    }
  }

  setupReplyMode(messageElement) {
    const messageId = messageElement.dataset.messageId;
    const content = messageElement
      .querySelector(".message-content")
      .textContent.replace("(edited)", "")
      .trim();

    let username =
      messageElement.getAttribute("data-username") ||
      messageElement.querySelector(".font-semibold")?.textContent.trim() ||
      this.state.currentUsername;

    if (!messageId || !content) {
      console.error("Missing required reply data:", {
        username,
        messageId,
        content,
      });
      return;
    }

    this.state.replyingTo = { id: messageId, content, username };
    this.elements.messageForm.querySelector(".reply-preview")?.remove();

    const replyPreview = document.createElement("div");
    replyPreview.className =
      "reply-preview bg-slate-100 dark:bg-slate-700 p-2 rounded-lg mb-2 flex items-center justify-between border-l-4 border-blue-500 dark:border-blue-400";
    replyPreview.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fas fa-reply text-blue-500 dark:text-blue-400"></i>
        <span class="text-sm text-slate-600 dark:text-slate-300">
          Replying to <span class="font-semibold">${this.escapeHtml(
            username
          )}</span>: 
          <span class="text-slate-500 dark:text-slate-400">${this.truncateText(
            content,
            50
          )}</span>
        </span>
      </div>
      <button type="button" class="cancel-reply-btn text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
        <i class="fas fa-times"></i>
      </button>
    `;

    // Add slide-down animation
    replyPreview.style.animation = "slideDown 0.2s ease-out";

    const cancelBtn = replyPreview.querySelector(".cancel-reply-btn");
    cancelBtn.addEventListener("click", () => {
      this.exitReplyMode();
    });

    this.inputWrapper.parentNode.insertBefore(replyPreview, this.inputWrapper);
    this.elements.messageInput.focus();

    // Scroll message into view and highlight it
    const replyMessageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );
    if (replyMessageEl) {
      replyMessageEl.scrollIntoView({ behavior: "smooth", block: "center" });
      replyMessageEl.classList.add("highlight-message");
      setTimeout(
        () => replyMessageEl.classList.remove("highlight-message"),
        1500
      );
    }
  }

  exitReplyMode() {
    const replyPreview =
      this.elements.messageForm.querySelector(".reply-preview");
    if (replyPreview) {
      replyPreview.style.animation = "slideUp 0.2s ease-out";
      replyPreview.addEventListener("animationend", () => {
        replyPreview.remove();
      });
    }
    this.state.replyingTo = null;
  }

  updateMessageReactions(messageId, emoji, username) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );
    if (!messageEl) return;

    const reactionsContainer = messageEl.querySelector(".message-reactions");
    if (!reactionsContainer) return;

    let reactionEl = Array.from(
      reactionsContainer.querySelectorAll(".emoji-reaction")
    ).find((el) => el.textContent.startsWith(emoji));

    if (reactionEl) {
      const countEl = reactionEl.querySelector("span:last-child");
      const currentCount = parseInt(countEl.textContent) || 0;
      countEl.textContent = currentCount + 1;

      // Enhanced pulse animation
      reactionEl.classList.add("reaction-pulse-animation");
      setTimeout(
        () => reactionEl.classList.remove("reaction-pulse-animation"),
        500
      );
    } else {
      // Create new reaction with pop-in animation
      const newReactionEl = document.createElement("div");
      newReactionEl.className =
        "emoji-reaction inline-flex items-center mr-2 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer reaction-pop-animation";
      newReactionEl.innerHTML = `
        <span class="mr-1">${emoji}</span>
        <span class="text-xs text-slate-600 dark:text-slate-300">1</span>
      `;
      reactionsContainer.insertBefore(
        newReactionEl,
        reactionsContainer.lastElementChild
      );
    }
  }

  updateMessageReadStatus(messageId, readBy, isRealTime = false) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );
    if (!messageEl) return;

    const username = messageEl.getAttribute("data-username");
    if (username !== this.state.currentUsername) return;

    const readReceiptContainer = messageEl.querySelector(
      ".read-receipt-container"
    );
    const readCountEl = messageEl.querySelector(".read-count");
    if (!readReceiptContainer || !readCountEl) return;

    const readers = Array.isArray(readBy) ? readBy : [readBy];
    const otherReaders = readers.filter(
      (reader) => reader !== this.state.currentUsername
    );
    const totalReaders = otherReaders.length;

    if (isRealTime) {
      readReceiptContainer.classList.add("transition-all", "duration-300");
    }

    if (totalReaders > 0) {
      readReceiptContainer.classList.remove(
        "text-slate-400",
        "dark:text-slate-500"
      );
      readReceiptContainer.classList.add("text-blue-500", "dark:text-blue-400");

      if (isRealTime) {
        readCountEl.style.transform = "translateY(-2px)";
        readCountEl.style.opacity = "0";

        setTimeout(() => {
          readCountEl.textContent = `Read by ${totalReaders}`;
          readCountEl.style.transform = "translateY(0)";
          readCountEl.style.opacity = "1";
        }, 150);
      } else {
        readCountEl.textContent = `Read by ${totalReaders}`;
      }
    } else {
      readReceiptContainer.classList.remove(
        "text-blue-500",
        "dark:text-blue-400"
      );
      readReceiptContainer.classList.add(
        "text-slate-400",
        "dark:text-slate-500"
      );
      readCountEl.textContent = "Delivered";
    }

    messageEl.classList.add("read");
    if (isRealTime) {
      setTimeout(() => {
        readReceiptContainer.classList.remove("transition-all", "duration-300");
      }, 300);
    }
  }

  // UI utilities
  createLoadingMoreIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "loading-more-indicator hidden";

    indicator.innerHTML = `
      <div class="flex items-center justify-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <svg class="animate-spin h-8 w-8 mr-3 text-blue-500 dark:text-blue-400" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Loading more messages...</span>
      </div>
    `;

    this.messagesContainer?.insertAdjacentElement("afterbegin", indicator);
    return indicator;
  }

  showLoadingMore(show) {
    if (this.loadingMoreIndicator) {
      this.loadingMoreIndicator.classList.toggle("hidden", !show);
    }
  }

  showUploadProgress(show) {
    const uploadProgress = document.createElement("div");
    uploadProgress.id = "uploadProgress";
    uploadProgress.className = `absolute top-0 left-0 w-full h-full bg-black/50 rounded-xl
                              flex items-center justify-center ${
                                show ? "" : "hidden"
                              }`;
    uploadProgress.innerHTML = `
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent"></div>
    `;

    const existing = this.inputWrapper.querySelector("#uploadProgress");
    if (existing) {
      existing.remove();
    }
    if (show) {
      this.inputWrapper.appendChild(uploadProgress);
    }
  }

  showError(message) {
    const errorToast = document.createElement("div");
    errorToast.className = `fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg
                           transform transition-all duration-300 ease-in-out z-50 error-toast`;
    errorToast.textContent = message;

    // Add slide-in animation
    errorToast.style.animation = "slideInRight 0.3s ease-out forwards";

    document.body.appendChild(errorToast);

    setTimeout(() => {
      errorToast.style.animation = "slideOutRight 0.3s ease-in forwards";
      errorToast.addEventListener("animationend", () => errorToast.remove());
    }, 3000);
  }

  showEmojiPicker(messageElement) {
    document
      .querySelectorAll(".emoji-picker")
      .forEach((picker) => picker.remove());

    const picker = document.createElement("div");
    picker.className =
      "emoji-picker fixed z-50 bg-white dark:bg-slate-700 shadow-lg rounded-lg p-2 emoji-picker-animation";

    // Expanded emoji selection
    const emojis = [
      "👍",
      "❤️",
      "😂",
      "🤔",
      "😍",
      "🙌",
      "🎉",
      "😱",
      "👏",
      "🔥",
      "💯",
      "✅",
    ];

    picker.innerHTML = emojis
      .map(
        (emoji) => `
        <button class="emoji-btn p-2 hover:bg-slate-100 dark:hover:bg-slate-600 rounded transition-colors">
          ${emoji}
        </button>
      `
      )
      .join("");

    document.body.appendChild(picker);

    const rect = messageElement.getBoundingClientRect();
    picker.style.position = "fixed";
    picker.style.top = `${rect.top - 60}px`;
    picker.style.left = `${rect.left}px`;

    // Handle emoji selection
    const handleEmojiSelection = (e) => {
      const emoji = e.target.closest(".emoji-btn")?.textContent?.trim();
      if (emoji) {
        const messageId = messageElement.dataset.messageId;
        this.chatManager.addEmojiReaction(messageId, emoji);
        picker.remove();
        document.removeEventListener("click", outsideClickHandler);
      }
    };

    const outsideClickHandler = (e) => {
      if (!picker.contains(e.target)) {
        picker.classList.add("emoji-picker-fade-out");
        picker.addEventListener("animationend", () => {
          picker.remove();
          document.removeEventListener("click", outsideClickHandler);
        });
      }
    };

    picker.addEventListener("click", handleEmojiSelection);
    document.addEventListener("click", outsideClickHandler);
  }

  // Helper methods
  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + "...";
  }
}

export default ChatUI;
