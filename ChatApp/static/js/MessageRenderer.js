const READ_RECEIPT_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
        <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
        <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
    </svg>
`;

class MessageRenderer {
  constructor(currentUser) {
    this.currentUser = currentUser;
    this.profilePhotoCache = new Map();
    this.profilePhotoCacheLimit = 100;
    this.LINKPREVIEW_API_KEY = "1c04df7c16f6df68d9c4d8fb66c68a2e";
    this.LINKPREVIEW_API_URL = "https://api.linkpreview.net/";
    this.MAX_MESSAGE_WIDTH = 85;
    this.initializeStyles();
  }

  setCurrentUser(user) {
    if (!user) {
      throw new Error("User object is required for setCurrentUser");
    }
    this.currentUser = user;
  }

  async getUserProfilePhoto(username) {
    if (this.profilePhotoCache.has(username)) {
      return this.profilePhotoCache.get(username);
    }

    try {
      const photoPromise = fetch(`/users/${username}/profile-photo`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to fetch profile photo: ${response.status}`
            );
          }
          return response.json();
        })
        .then((data) => data.profile_photo_url)
        .catch((error) => {
          console.error("Failed to fetch profile photo:", error);
          return null;
        });

      // Manage cache size
      if (this.profilePhotoCache.size >= this.profilePhotoCacheLimit) {
        const firstKey = this.profilePhotoCache.keys().next().value;
        this.profilePhotoCache.delete(firstKey);
      }

      this.profilePhotoCache.set(username, photoPromise);
      return await photoPromise;
    } catch (error) {
      console.error("Unexpected error in getUserProfilePhoto:", error);
      return null;
    }
  }

  async fetchLinkPreview(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const apiUrl = new URL(this.LINKPREVIEW_API_URL);
      apiUrl.searchParams.append("key", this.LINKPREVIEW_API_KEY);
      apiUrl.searchParams.append("q", url);

      const response = await fetch(apiUrl.toString(), {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`Link preview failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const hostname = new URL(url).hostname;

      return {
        url: data.url,
        title: data.title || hostname,
        description: data.description || "",
        image: data.image ? data.image.replace("http:", "https:") : null,
        favicon: data.favicon
          ? data.favicon.replace("http:", "https:")
          : `https://www.google.com/s2/favicons?domain=${hostname}`,
        hostname,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Link preview request timed out");
      } else {
        console.error("Error fetching link preview:", error);
      }
      return null;
    }
  }

  extractUrlFromText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex)?.[0] || null;
  }

  async generateLinkPreviewHTML(url) {
    const previewData = await this.fetchLinkPreview(url);
    if (!previewData) return "";

    const previewId = `preview-${Date.now()}`;
    const imageSection = previewData.image
      ? `<div class="relative w-full h-48 bg-slate-100 dark:bg-slate-800">
           <img src="${previewData.image}" 
           class="w-full h-48 object-cover opacity-0 transition-opacity duration-300" 
           alt="${previewData.title}"
           onload="this.classList.remove('opacity-0');this.parentNode.querySelector('.loading-spinner').classList.add('hidden')"
           loading="lazy">
           <div class="absolute inset-0 flex items-center justify-center loading-spinner">
             <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
           </div>
         </div>`
      : "";

    const faviconSection = previewData.favicon
      ? `<img src="${previewData.favicon}" class="w-4 h-4" alt="Site icon">`
      : "";

    const descriptionSection = previewData.description
      ? `<p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${previewData.description}</p>`
      : "";

    return `
      <a href="${previewData.url}" target="_blank" rel="noopener noreferrer" 
         id="${previewId}"
         class="link-preview mt-2 block border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200">
        <div class="flex flex-col">
          ${imageSection}
          <div class="p-3">
            <div class="flex items-center gap-2 mb-1">
              ${faviconSection}
              <span class="text-xs text-slate-500 dark:text-slate-400">${
                previewData.hostname
              }</span>
            </div>
            <h3 class="font-medium text-sm mb-1">${
              previewData.title || "Untitled"
            }</h3>
            ${descriptionSection}
          </div>
        </div>
      </a>
    `;
  }

  escapeHtml(unsafe) {
    return unsafe;
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + "...";
  }

  formatTimeDisplay(messageDate) {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const timeFormat = { hour: "2-digit", minute: "2-digit", hour12: true };

    if (messageDate.toLocaleDateString() === now.toLocaleDateString()) {
      return messageDate.toLocaleTimeString([], timeFormat);
    } else if (
      messageDate.toLocaleDateString() === yesterday.toLocaleDateString()
    ) {
      return `Yesterday ${messageDate.toLocaleTimeString([], timeFormat)}`;
    } else if (now.getFullYear() === messageDate.getFullYear()) {
      return messageDate.toLocaleString([], {
        month: "short",
        day: "numeric",
        ...timeFormat,
      });
    } else {
      return messageDate.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...timeFormat,
      });
    }
  }

  async createMessageElement(
    message,
    showHeader = true,
    previousMessage = null,
    isLastInGroup = false
  ) {
    const template = document.createElement("template");
    const messageHTML = await this.createMessageHTML(
      message,
      showHeader,
      previousMessage,
      isLastInGroup
    );
    template.innerHTML = messageHTML.trim();
    return template.content.firstChild;
  }

  createImageReplyPreview(imageUrl) {
    return `
      <div class="relative w-8 h-8 rounded-md overflow-hidden border border-slate-300 dark:border-slate-600">
        <img src="${imageUrl}" alt="Image reply" class="w-full h-full object-cover">
      </div>
    `;
  }

  wrapLongText(text) {
    if (!text) return "";

    const words = text.split(" ");
    const wrappedWords = words.map((word) => {
      if (word.length > this.MAX_MESSAGE_WIDTH) {
        let result = "";
        for (let i = 0; i < word.length; i++) {
          result += word[i];
          if (
            i > 0 &&
            i < word.length - 1 &&
            i % Math.floor(this.MAX_MESSAGE_WIDTH / 2) === 0
          ) {
            result += "\u200B"; // Zero-width space
          }
        }
        return result;
      }
      return word;
    });

    return wrappedWords.join(" ");
  }

  getBubbleShape(isCurrentUser, messagePosition) {
    // Updated bubble shapes for better symmetry between first and last messages
    if (isCurrentUser) {
      switch (messagePosition) {
        case "first":
          return "rounded-t-2xl rounded-l-2xl rounded-br-md"; // First in group
        case "middle":
          return "rounded-l-2xl rounded-r-md"; // Middle
        case "last":
          return "rounded-b-2xl rounded-l-2xl rounded-tr-md bubble-last current-user"; // Last in group - now symmetrical with first
        default:
          return "rounded-2xl"; // Single message
      }
    } else {
      switch (messagePosition) {
        case "first":
          return "rounded-t-2xl rounded-r-2xl rounded-bl-md"; // First in group
        case "middle":
          return "rounded-r-2xl rounded-l-md"; // Middle
        case "last":
          return "rounded-b-2xl rounded-r-2xl rounded-tl-md bubble-last other-user"; // Last in group - now symmetrical with first
        default:
          return "rounded-2xl"; // Single message
      }
    }
  }

  async createMessageHTML(
    {
      id,
      username,
      content,
      timestamp,
      edited = false,
      reply_to = null,
      reactions = {},
      read_by = [],
      type = "text",
    },
    showHeader = true,
    previousMessage = null,
    isLastInGroup = false
  ) {
    // Determine if we should show header based on previous message
    if (
      previousMessage &&
      previousMessage.username === username &&
      new Date(timestamp) - new Date(previousMessage.timestamp) < 5 * 60 * 1000
    ) {
      showHeader = false;
    }

    const messageDate = new Date(timestamp);
    const messageId = id || `temp-${Date.now()}`;
    const isCurrentUser = this.currentUser?.username === username;
    const timeDisplay = this.formatTimeDisplay(messageDate);

    // Message position for bubble styling
    let messagePosition;
    if (showHeader) {
      messagePosition = "first";
    } else if (isLastInGroup) {
      messagePosition = "last";
    } else {
      messagePosition = "middle";
    }

    // Message styling
    const bubbleClasses = isCurrentUser
      ? "bg-blue-500 dark:bg-blue-600 text-white"
      : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100";
    const bubbleShape = this.getBubbleShape(isCurrentUser, messagePosition);
    const bubbleShadow = isLastInGroup ? "shadow-md" : "shadow-sm";

    // Read receipt
    const readReceiptHtml = this.createReadReceiptHtml(
      isCurrentUser,
      isLastInGroup,
      read_by
    );

    // Profile photo
    let profilePhotoHtml = "";
    if (showHeader && !isCurrentUser) {
      const profilePhotoUrl = await this.getUserProfilePhoto(username);
      if (profilePhotoUrl) {
        profilePhotoHtml = `
          <img src="${profilePhotoUrl}" 
               alt="${username}'s profile" 
               class="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-600">
        `;
      } else {
        // Fallback avatar if no profile photo
        profilePhotoHtml = `
          <div class="w-8 h-8 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold">
            ${username.charAt(0).toUpperCase()}
          </div>
        `;
      }
    }

    // IG-style Layout: Profile Photo in own column + centered username
    const headerHtml =
      showHeader && !isCurrentUser
        ? `
        <div class="flex flex-col items-center mb-1">
          <div class="text-xs font-bold text-slate-500 dark:text-slate-400 text-center">
            ${username}
          </div>
        </div>
      `
        : "";

    // Reply
    const replyClasses = isCurrentUser
      ? "bg-blue-400/70 dark:bg-blue-500/70 text-white"
      : "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200";
    const replyContent = this.createReplyHtml(reply_to, replyClasses);

    // Edited indicator
    const editedLabel = edited
      ? `<span class="text-xs opacity-60 ml-1" aria-label="Edited" title="Edited at ${new Date(
          timestamp
        ).toLocaleString()}">·</span>`
      : "";

    // Reactions
    const reactionsHtml = this.createReactionsHtml(reactions, isCurrentUser);

    // Message actions
    const messageActionsHtml = this.createMessageActionsHtml(
      isCurrentUser,
      type
    );

    // Message content and link preview
    let messageContent,
      linkPreviewHtml = "";
    if (type === "image") {
      messageContent = this.createImageContentHtml(content);
    } else {
      const url = this.extractUrlFromText(content);
      const wrappedContent = this.wrapLongText(content);
      messageContent = `<div class="break-words overflow-hidden">${
        this.formatMessageText
          ? this.formatMessageText(wrappedContent)
          : this.escapeHtml(wrappedContent)
      }</div>`;

      if (url) {
        linkPreviewHtml = await this.generateLinkPreviewHTML(url);
      }
    }

    // Spacing logic
    const spacingClass = isLastInGroup ? "mb-2" : "mb-0.5";
    const bubbleMargin = !showHeader ? "mt-0.5" : "";

    // New Instagram-style layout with profile photo in its own column
    return `
    <div class="flex message relative ${spacingClass} group animate-fade-in" 
        data-message-id="${messageId}"
        data-username="${username}"
        data-type="${type}"
        data-timestamp="${messageDate.getTime()}"
        data-position="${messagePosition}">
        
        ${
          !isCurrentUser
            ? `
        <div class="flex-shrink-0 w-10 mr-2 ${
          showHeader ? "block" : "opacity-0"
        }">
          ${profilePhotoHtml}
        </div>
        `
            : ""
        }
        
        <div class="flex flex-col ${
          isCurrentUser ? "items-end ml-auto" : "items-start"
        } max-w-[75%] sm:max-w-[85%] md:max-w-[75%] relative">
            ${headerHtml}
            <div class="message-container relative ${bubbleMargin}">
                ${replyContent}
                <div class="message-bubble px-4 py-2 ${bubbleShape} ${bubbleClasses} ${bubbleShadow}">
                    <div class="text-sm message-content">
                        ${messageContent}${editedLabel}
                    </div>
                </div>
                ${linkPreviewHtml}
                ${reactionsHtml}
            </div>
            
            ${messageActionsHtml}
            
            ${
              isLastInGroup
                ? `
            <div class="message-info text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-slate-400 dark:text-slate-500 flex items-center gap-1" 
                 aria-label="Message info">
                <span class="message-timestamp" title="${messageDate.toLocaleString()}">${timeDisplay}</span>
                ${readReceiptHtml}
            </div>
            `
                : ""
            }
        </div>
        
        ${
          isCurrentUser
            ? `
        <div class="flex-shrink-0 w-10 ml-2 ${
          showHeader ? "block" : "opacity-0"
        }">
        </div>
        `
            : ""
        }
    </div>
  `;
  }

  createReadReceiptHtml(isCurrentUser, isLastInGroup, read_by) {
    if (!isCurrentUser || !isLastInGroup) return "";

    return `
      <div class="read-receipt-container flex items-center gap-1 text-xs ${
        read_by.length >= 2
          ? "text-blue-500 dark:text-blue-400"
          : "text-slate-400 dark:text-slate-500"
      }" aria-label="${read_by.length >= 2 ? "Read" : "Delivered"}">
        ${READ_RECEIPT_ICON}
        ${read_by.length >= 2 ? "Read" : "Delivered"}
      </div>
    `;
  }

  createReplyHtml(reply_to, replyClasses) {
    if (!reply_to) return "";

    if (reply_to.type === "image") {
      return `
        <div class="reply-reference flex items-start gap-2 p-2 mb-1 rounded-lg ${replyClasses}" 
             aria-label="Replying to ${reply_to.username}'s image">
          <div class="reply-icon text-blue-200 dark:text-blue-300">
            <i class="fas fa-reply"></i>
          </div>
          <div class="reply-content flex items-center gap-2">
            <div class="reply-header text-xs font-semibold">
              ${reply_to.username}
            </div>
            ${this.createImageReplyPreview(reply_to.content)}
            <div class="text-xs italic">Photo</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="reply-reference flex items-start gap-2 p-2 mb-1 rounded-lg ${replyClasses}" 
             aria-label="Replying to ${reply_to.username}">
          <div class="reply-icon text-blue-200 dark:text-blue-300">
            <i class="fas fa-reply"></i>
          </div>
          <div class="reply-content">
            <div class="reply-header text-xs font-semibold">
              ${reply_to.username}
            </div>
            <div class="reply-body text-xs truncate">
              ${this.truncateText(reply_to.content, 100)}
            </div>
          </div>
        </div>
      `;
    }
  }

  createReactionsHtml(reactions, isCurrentUser) {
    if (Object.entries(reactions || {}).length === 0) return "";

    return `
      <div class="emoji-reactions absolute ${
        isCurrentUser ? "-left-2" : "-right-2"
      } top-1/2 transform ${
      isCurrentUser ? "-translate-x-full" : "translate-x-full"
    } -translate-y-1/2
          px-2 py-1 rounded-full bg-white dark:bg-slate-800 shadow-sm 
          border border-slate-100 dark:border-slate-700 flex items-center z-10
          hover:shadow-md transition-shadow duration-200">
        ${Object.entries(reactions || {})
          .map(
            ([emoji, users]) => `
            <div class="emoji-reaction inline-flex items-center mx-0.5 text-sm cursor-pointer hover:scale-110 transition-transform duration-200" 
                 title="${users.join(", ")}">
              <span>${emoji}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400 ml-0.5">${
                users.length
              }</span>
            </div>
          `
          )
          .join("")}
      </div>
    `;
  }

  createMessageActionsHtml(isCurrentUser, type) {
    const editButtonHtml =
      isCurrentUser && type !== "image"
        ? `<button class="edit-message-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                aria-label="Edit" title="Edit">
                <i class="fas fa-edit"></i>
            </button>`
        : "";

    const deleteButtonHtml = isCurrentUser
      ? `<button class="delete-message-btn text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                aria-label="Delete" title="Delete">
                <i class="fas fa-trash"></i>
            </button>`
      : "";

    return `
      <div class="message-actions absolute -top-7 ${
        isCurrentUser ? "right-0" : "left-0"
      } 
          opacity-0 group-hover:opacity-100 transform scale-95 group-hover:scale-100 transition-all duration-200 
          bg-white dark:bg-slate-800 rounded-full shadow-lg px-2 py-1 flex gap-2 z-20">
          <button class="reaction-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                  aria-label="Add Reaction" title="React">
              <i class="fas fa-smile"></i>
          </button>
          <button class="reply-message-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                  aria-label="Reply" title="Reply">
              <i class="fas fa-reply"></i>
          </button>
          ${editButtonHtml}
          ${deleteButtonHtml}
      </div>
    `;
  }

  createImageContentHtml(content) {
    return `
      <div class="message-image-container relative">
        <img src="${this.escapeHtml(content)}" 
             alt="Shared image" 
             class="rounded-lg w-full max-w-xs object-cover cursor-pointer hover:opacity-90 transition-opacity"
             loading="lazy"
             onclick="window.openImageViewer && window.openImageViewer('${this.escapeHtml(
               content
             )}')">
        <div class="absolute bottom-0 right-0 p-1 bg-black/50 rounded-bl-lg rounded-tr-lg text-white text-xs">
          <i class="fas fa-search-plus"></i>
        </div>
      </div>
    `;
  }

  formatMessageText(text) {
    if (!text) return "";

    // Remove zero-width spaces
    let formattedText = text.replace(/\u200B/g, "");

    // First escape the HTML
    formattedText = this.escapeHtml(formattedText);

    // Convert URLs to clickable links
    formattedText = formattedText.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-500 dark:text-blue-400 hover:underline break-all">$1</a>'
    );

    // Convert @mentions
    formattedText = formattedText.replace(
      /@(\w+)/g,
      '<span class="mention text-blue-500 dark:text-blue-400 cursor-pointer">@$1</span>'
    );

    // Convert #hashtags
    formattedText = formattedText.replace(
      /#(\w+)/g,
      '<span class="hashtag text-blue-500 dark:text-blue-400 cursor-pointer">#$1</span>'
    );

    return formattedText;
  }

  async renderMessageGroup(messages) {
    if (!messages || messages.length === 0) return "";

    let html = "";
    let previousMessage = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const showHeader =
        i === 0 || message.username !== messages[i - 1].username;
      const isLastInGroup =
        i === messages.length - 1 ||
        message.username !== messages[i + 1].username;

      html += await this.createMessageHTML(
        message,
        showHeader,
        previousMessage,
        isLastInGroup
      );
      previousMessage = message;
    }

    return html;
  }

  initializeStyles() {
    if (document.getElementById("message-renderer-styles")) return;

    const style = document.createElement("style");
    style.id = "message-renderer-styles";
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .animate-fade-in {
        animation: fadeIn 0.3s ease forwards;
      }
      
      .message-content {
        word-break: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
      }
      
      /* Message bubbles */
      .message-bubble {
        transition: border-radius 0.2s ease-in-out, margin 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
      }
      
      /* Last bubble in groups styling */
      .bubble-last {
        position: relative;
      }
      
      /* Instagram-style layout adjustments */
      .message {
        display: flex;
        align-items: flex-start;
      }
      
      /* Bubble tails - symmetrical with first bubble */
      .bubble-last.current-user::after {
        content: "";
        position: absolute;
        bottom: -6px;
        right: 12px;
        width: 12px;
        height: 12px;
        background: inherit;
        border-bottom-right-radius: 50%;
        transform: rotate(45deg);
        z-index: -1;
      }
      
      .bubble-last.other-user::after {
        content: "";
        position: absolute;
        bottom: -6px;
        left: 12px;
        width: 12px;
        height: 12px;
        background: inherit;
        border-bottom-left-radius: 50%;
        transform: rotate(-45deg);
        z-index: -1;
      }
      
      /* Message grouping spacing */
      [data-position="last"] .message-bubble {
        margin-bottom: 4px;
      }
      
      /* Middle bubble connections */
      [data-position="middle"]:not(.justify-end) .message-bubble {
        border-top-left-radius: 0.25rem;
        border-bottom-left-radius: 0.25rem;
      }
      
      [data-position="middle"].justify-end .message-bubble {
        border-top-right-radius: 0.25rem;
        border-bottom-right-radius: 0.25rem;
      }
      
      /* First bubble in a group */
      [data-position="first"]:not(.justify-end) .message-bubble {
        border-top-left-radius: 1rem;
      }
      
      [data-position="first"].justify-end .message-bubble {
        border-top-right-radius: 1rem;
      }
        .message-actions {
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
    z-index: 10;
}

.message:hover .message-actions {
    visibility: visible;
    opacity: 1;
}

.action-button {
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s ease-in-out;
}

.action-button:hover {
    background-color: #f3f4f6;
}
    @keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
    .loading-more-indicator {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(255, 255, 255, 0.9);
}

.hidden {
    display: none;
}

@keyframes slideUp {
    from {
        opacity: 1; 
        transform: translateY(0);
    }
    to {
        opacity: 0;
        transform: translateY(-10px);
    }
}
    `;
    document.head.appendChild(style);
  }
}

export default MessageRenderer;
