import WebSocketManager from "./WebSocketManager.js";
import ImageGallery from "./ImageGallery.js";
import MessageRenderer from "./MessageRenderer.js";
import ChatManager from "./ChatManager.js";

class ChatUI {
  constructor(options = {}) {
    // DOM Elements
    this.messagesContainer = document.querySelector("#messagesContainer");
    this.messageContainer = document.querySelector("#messages");
    this.loadingSpinner = document.querySelector("#loadingSpinner");
    this.messageForm = document.querySelector("#messageForm");
    this.messageInput = document.querySelector("#messageInput");
    this.roomNameElement = document.querySelector("#roomName");
    this.roomCodeElement = document.querySelector("#roomCode");
    this.inputWrapper = this.messageForm.querySelector(".input-wrapper");
    this.imageInput = document.querySelector("#imageInput");

    // Services & Utilities
    this.wsManager = WebSocketManager.getInstance();
    this.chatManager = ChatManager.instance;
    this.messageRenderer = new MessageRenderer();
    this.imageGallery = new ImageGallery();
    this.loadingMoreIndicator = this.createLoadingMoreIndicator();

    // State
    this.isScrolledToBottom = true;
    this.lastMessageUsername = null;
    this.replyingTo = null;
    this.currentUsername = null;
    this.typingUsers = new Set();
    this.typingTimeout = null;

    // Initialize components
    this.setupEventListeners();
    this.setupTypingIndicator();
    this.setupImageUpload();
  }

  // Core initialization methods
  setupEventListeners() {
    // Scroll handling
    this.messageContainer.addEventListener("scroll", () => {
      this.isScrolledToBottom = this.isNearBottom();
      this.updateScrollIndicator();
    });

    // Message form submission
    this.messageForm.addEventListener("submit", (e) =>
      this.handleMessageSubmit(e)
    );

    // Image gallery handling
    this.messageContainer.addEventListener("click", (e) => {
      const clickedImage = e.target.closest(".message-image-container img");
      if (clickedImage) {
        e.preventDefault();
        this.imageGallery.show(clickedImage.src);
      }
    });

    // Message actions (reactions, replies, edits, deletes)
    this.setupMessageActionListeners();
  }

  setupMessageActionListeners() {
    // Reaction handling
    this.messageContainer.addEventListener("click", (e) => {
      const reactionBtn = e.target.closest(".reaction-btn");
      const addReactionBtn = e.target.closest(".add-reaction-btn");
      if (reactionBtn || addReactionBtn) {
        const messageElement = (reactionBtn || addReactionBtn).closest(
          ".message"
        );
        e.stopPropagation();
        this.showEmojiPicker(messageElement);
      }
    });

    // Message manipulation buttons
    this.messageContainer.addEventListener("click", (e) => {
      const replyBtn = e.target.closest(".reply-message-btn");
      const editBtn = e.target.closest(".edit-message-btn");
      const deleteBtn = e.target.closest(".delete-message-btn");
      const cancelReplyBtn = e.target.closest(".cancel-reply-btn");

      if (replyBtn) {
        this.setupReplyMode(replyBtn.closest(".message"));
      } else if (cancelReplyBtn) {
        this.exitReplyMode();
      } else if (editBtn) {
        this.setupEditMode(editBtn.closest(".message"));
      } else if (deleteBtn) {
        const messageElement = deleteBtn.closest(".message");
        const messageId = messageElement.dataset.messageId;

        if (confirm("Are you sure you want to delete this message?")) {
          this.chatManager.deleteMessage(messageId);
        }
      }
    });
  }

  setupTypingIndicator() {
    const typingContainer = document.createElement("div");
    typingContainer.id = "typingIndicator";
    typingContainer.className =
      "hidden px-4 py-2 text-sm text-slate-500 dark:text-slate-400 italic";
    this.messageContainer.parentNode.insertBefore(
      typingContainer,
      this.messageContainer.nextSibling
    );

    this.messageInput.addEventListener("input", () => {
      if (this.chatManager) {
        clearTimeout(this.typingTimeout);
        this.chatManager.sendTypingStatus(true);

        this.typingTimeout = setTimeout(() => {
          this.chatManager.sendTypingStatus(false);
        }, 2000);
      }
    });
  }

  setupImageUpload() {
    const uploadButton = document.getElementById("imageUploadButton");
    if (!uploadButton) {
      console.error("Image upload button not found.");
      return;
    }

    uploadButton.addEventListener("click", () => this.imageInput.click());
    this.imageInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.chatManager.handleImageUpload(e.target.files);
        e.target.value = "";
      }
    });
  }

  // UI state management
  setCurrentUser(user) {
    this.currentUsername = user.username;
    this.messageRenderer.setCurrentUser(user);
  }

  setChatManager(chatManager) {
    this.chatManager = chatManager;
  }

  setLoading(isLoading) {
    this.loadingSpinner.classList.toggle("hidden", !isLoading);
    this.messagesContainer.classList.toggle("hidden", isLoading);
    this.messageForm.classList.toggle("hidden", isLoading);
  }

  enableForm(isEnabled) {
    this.messageInput.disabled = !isEnabled;
    this.messageForm.querySelector("button").disabled = !isEnabled;
  }

  updateRoomInfo(room) {
    this.roomNameElement.textContent = room.name;
    this.roomCodeElement.setAttribute("data-code", room.code);
    document.title = `Channel Chat - ${room.name}`;
  }

  // Scroll handling
  isNearBottom() {
    const threshold = 100;
    return (
      this.messageContainer.scrollHeight -
        this.messageContainer.scrollTop -
        this.messageContainer.clientHeight <
      threshold
    );
  }

  scrollToBottom(force = false) {
    if (force || this.isScrolledToBottom) {
      if (this.messageContainer) {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        this.isScrolledToBottom = true;
        this.updateScrollIndicator();
      }
    }
  }

  updateScrollIndicator() {
    const indicator = document.getElementById("scrollIndicator");
    if (indicator) {
      indicator.classList.toggle("hidden", this.isScrolledToBottom);
    }
  }

  // Message handling
  handleMessageSubmit(e) {
    e.preventDefault();
    const content = this.messageInput.value.trim();

    if (content && this.wsManager.isWebSocketOpen()) {
      const messageData = {
        content,
        username: this.currentUsername,
        timestamp: new Date().toISOString(),
        replyTo: this.replyingTo
          ? {
              id: this.replyingTo.id,
              content: this.replyingTo.content,
              username: this.replyingTo.username,
            }
          : null,
      };

      this.chatManager.sendMessage(messageData);
      this.messageInput.value = "";
      this.messageInput.style.height = "auto";
      this.exitReplyMode();
    }
  }

  updateTypingIndicator(typingUsers) {
    const container = document.getElementById("typingIndicator");
    if (!container) return;

    // Convert to array if it's a Set
    const usersArray = Array.isArray(typingUsers)
      ? typingUsers
      : Array.from(typingUsers);

    // Filter out current user
    const otherTypingUsers = usersArray.filter(
      (userId) => userId !== this.currentUsername
    );

    if (otherTypingUsers.length === 0) {
      container.classList.add("hidden");
      return;
    }

    let message = "";
    if (otherTypingUsers.length === 1) {
      message = `${otherTypingUsers[0]} is typing...`;
    } else if (otherTypingUsers.length === 2) {
      message = `${otherTypingUsers[0]} and ${otherTypingUsers[1]} are typing...`;
    } else {
      message = "Several people are typing...";
    }

    container.textContent = message;
    container.classList.remove("hidden");
  }

  clearMessages() {
    this.messageContainer.innerHTML = "";
  }

  async displayMessages(messages) {
    if (!this.messageContainer) return;

    this.messageContainer.innerHTML = "";
    this.lastMessageUsername = null;

    for (const message of messages) {
      const processedMessage = {
        ...message,
        type:
          message.type ||
          (message.content?.includes("firebasestorage.googleapis.com")
            ? "image"
            : "text"),
      };

      const showHeader = processedMessage.username !== this.lastMessageUsername;
      const messageElement = await this.messageRenderer.createMessageElement(
        processedMessage,
        showHeader
      );

      this.messageContainer.appendChild(messageElement);
      this.lastMessageUsername = processedMessage.username;
    }

    this.scrollToBottom();
  }

  async prependMessages(messages) {
    if (!this.messageContainer) return;

    const scrollBottom =
      this.messageContainer.scrollHeight - this.messageContainer.scrollTop;
    const tempLastMessageUsername = this.lastMessageUsername;
    this.lastMessageUsername = null;

    for (const message of messages.reverse()) {
      const processedMessage = {
        ...message,
        type:
          message.type ||
          (message.content?.includes("firebasestorage.googleapis.com")
            ? "image"
            : "text"),
      };

      const showHeader = processedMessage.username !== this.lastMessageUsername;
      const messageElement = await this.messageRenderer.createMessageElement(
        processedMessage,
        showHeader
      );

      const insertAfter =
        this.loadingMoreIndicator &&
        this.loadingMoreIndicator.parentElement === this.messageContainer
          ? this.loadingMoreIndicator.nextSibling
          : null;

      if (insertAfter) {
        this.messageContainer.insertBefore(messageElement, insertAfter);
      } else {
        this.messageContainer.insertBefore(
          messageElement,
          this.messageContainer.firstChild
        );
      }

      this.lastMessageUsername = processedMessage.username;
    }

    this.lastMessageUsername = tempLastMessageUsername;
    this.messageContainer.scrollTop =
      this.messageContainer.scrollHeight - scrollBottom;
    this.showLoadingMore(false);
  }

  async appendMessage(message) {
    if (message.id) {
      const existingMessage = this.messageContainer.querySelector(
        `.message[data-message-id="${message.id}"]`
      );

      if (existingMessage) {
        if (message.read_by) {
          this.updateMessageReadStatus(message.id, message.read_by);
        }
        return;
      }
    }

    const tempId = message.id || `temp-${Date.now()}`;
    const shouldScroll = this.isNearBottom();
    const showHeader = message.username !== this.lastMessageUsername;

    const reply_to = message.reply_to
      ? {
          message_id: message.reply_to.id || message.reply_to.message_id,
          content: message.reply_to.content,
          username: message.reply_to.username,
        }
      : null;

    const messageElement = await this.messageRenderer.createMessageElement(
      {
        ...message,
        id: tempId,
        reply_to,
      },
      showHeader
    );

    this.messageContainer.appendChild(messageElement);
    this.lastMessageUsername = message.username;

    if (shouldScroll || message.username !== this.currentUsername) {
      this.scrollToBottom(true);
    }
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
      <button type="submit" class="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300">
          <i class="fas fa-check"></i>
      </button>
      <button type="button" class="cancel-edit text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
          <i class="fas fa-times"></i>
      </button>
    `;

    contentDiv.replaceWith(editForm);

    const input = editForm.querySelector("input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newContent = input.value.trim();
      if (newContent && newContent !== currentContent) {
        const messageId = messageElement.dataset.messageId;
        await this.chatManager.editMessage(messageId, newContent);
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
    editForm.replaceWith(contentDiv);
  }

  updateMessage(messageId, content, edited = true) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );

    if (messageEl) {
      const contentDiv = messageEl.querySelector(".message-content");
      contentDiv.textContent = content;

      if (edited && !contentDiv.textContent.includes("(edited)")) {
        contentDiv.insertAdjacentHTML(
          "beforeend",
          '<span class="text-xs text-slate-400 ml-2">(edited)</span>'
        );
      }
    }
  }

  deleteMessage(messageId) {
    const messageEl = document.querySelector(
      `.message[data-message-id="${messageId}"]`
    );

    if (messageEl) {
      // Add fade-out animation before removing
      messageEl.classList.add("fade-out");
      setTimeout(() => messageEl.remove(), 300);
    }
  }

  setupReplyMode(messageElement) {
    const messageId = messageElement.dataset.messageId;
    const content = messageElement
      .querySelector(".message-content")
      .textContent.replace("(edited)", "")
      .trim();

    let username = messageElement.getAttribute("data-username");

    if (!username) {
      const headerUsername = messageElement.querySelector(".font-semibold");
      username = headerUsername
        ? headerUsername.textContent.trim()
        : this.currentUsername;
    }

    if (!messageId || !content) {
      console.error("Missing required reply data:", {
        username,
        messageId,
        content,
      });
      return;
    }

    this.replyingTo = { id: messageId, content, username };
    this.messageForm.querySelector(".reply-preview")?.remove();

    const replyPreview = document.createElement("div");
    replyPreview.className =
      "reply-preview bg-slate-100 dark:bg-slate-700 p-2 rounded-lg mb-2 flex items-center justify-between";
    replyPreview.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fas fa-reply text-slate-400 dark:text-slate-500"></i>
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
      <button type="button" class="cancel-reply-btn text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
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
    this.messageInput.focus();
  }

  exitReplyMode() {
    const replyPreview = this.messageForm.querySelector(".reply-preview");
    if (replyPreview) {
      replyPreview.style.animation = "slideUp 0.2s ease-out";
      replyPreview.addEventListener("animationend", () => {
        replyPreview.remove();
      });
    }
    this.replyingTo = null;
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

      // Add pulse animation
      reactionEl.classList.add("pulse-animation");
      setTimeout(() => reactionEl.classList.remove("pulse-animation"), 500);
    } else {
      // Create new reaction with pop-in animation
      const newReactionEl = document.createElement("div");
      newReactionEl.className =
        "emoji-reaction inline-flex items-center mr-2 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-sm pop-in-animation";
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
    if (username !== this.currentUsername) return;

    const readReceiptContainer = messageEl.querySelector(
      ".read-receipt-container"
    );
    const readCountEl = messageEl.querySelector(".read-count");
    if (!readReceiptContainer || !readCountEl) return;

    const readers = Array.isArray(readBy) ? readBy : [readBy];
    const otherReaders = readers.filter(
      (reader) => reader !== this.currentUsername
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
