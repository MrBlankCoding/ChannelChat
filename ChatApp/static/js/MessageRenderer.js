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
    this.profilePhotoCacheLimit = 100; // Limit cache size
    this.LINKPREVIEW_API_KEY = "1c04df7c16f6df68d9c4d8fb66c68a2e";
    this.LINKPREVIEW_API_URL = "https://api.linkpreview.net/";
    this.MAX_MESSAGE_WIDTH = 85; // Character limit for message width
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

      // Check cache size before adding
      if (this.profilePhotoCache.size >= this.profilePhotoCacheLimit) {
        // Remove oldest entry (first key in the Map)
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
      // Add timeout for fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

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
      return {
        url: data.url,
        title: data.title || new URL(url).hostname,
        description: data.description || "",
        image: data.image ? data.image.replace("http:", "https:") : null,
        favicon: data.favicon
          ? data.favicon.replace("http:", "https:")
          : `https://www.google.com/s2/favicons?domain=${
              new URL(data.url).hostname
            }`,
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

    // Add loading state
    const previewId = `preview-${Date.now()}`;

    return `
      <a href="${previewData.url}" target="_blank" rel="noopener noreferrer" 
         id="${previewId}"
         class="link-preview mt-2 block border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200">
        <div class="flex flex-col">
          ${
            previewData.image
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
              : ""
          }
          <div class="p-3">
            <div class="flex items-center gap-2 mb-1">
              ${
                previewData.favicon
                  ? `<img src="${previewData.favicon}" class="w-4 h-4" alt="Site icon">`
                  : ""
              }
              <span class="text-xs text-slate-500 dark:text-slate-400">${
                new URL(previewData.url).hostname
              }</span>
            </div>
            <h3 class="font-medium text-sm mb-1">${
              previewData.title || "Untitled"
            }</h3>
            ${
              previewData.description
                ? `<p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${previewData.description}</p>`
                : ""
            }
          </div>
        </div>
      </a>
    `;
  }

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
    previousMessage = null
  ) {
    const template = document.createElement("template");
    const messageHTML = await this.createMessageHTML(
      message,
      showHeader,
      previousMessage
    );
    template.innerHTML = messageHTML.trim();
    return template.content.firstChild;
  }

  // Create a preview for image replies
  createImageReplyPreview(imageUrl) {
    return `
      <div class="relative w-8 h-8 rounded-md overflow-hidden border border-slate-300 dark:border-slate-600">
        <img src="${imageUrl}" alt="Image reply" class="w-full h-full object-cover">
      </div>
    `;
  }

  // Handle word wrapping for long text
  wrapLongText(text) {
    if (!text) return "";

    const words = text.split(" ");
    const wrappedWords = words.map((word) => {
      // If word is longer than maximum width, add zero-width spaces to allow breaking
      if (word.length > this.MAX_MESSAGE_WIDTH) {
        // Insert zero-width space character every MAX_MESSAGE_WIDTH/2 characters
        let result = "";
        for (let i = 0; i < word.length; i++) {
          result += word[i];
          if (
            i > 0 &&
            i < word.length - 1 &&
            i % Math.floor(this.MAX_MESSAGE_WIDTH / 2) === 0
          ) {
            result += "\u200B"; // Zero-width space (character)
          }
        }
        return result;
      }
      return word;
    });

    return wrappedWords.join(" ");
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
    previousMessage = null
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

    // Messsage bubble
    const bubbleClasses = isCurrentUser
      ? "bg-blue-500 dark:bg-blue-600 text-white"
      : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100";

    const bubbleShape = isCurrentUser
      ? "rounded-3xl rounded-br-lg"
      : "rounded-3xl rounded-bl-lg";

    // Read receipt 
    const readReceiptHtml = isCurrentUser
      ? `
      <div class="read-receipt-container flex items-center gap-1 text-xs ${
        read_by.length >= 2
          ? "text-blue-500 dark:text-blue-400"
          : "text-slate-400 dark:text-slate-500"
      }" aria-label="${read_by.length >= 2 ? "Read" : "Delivered"}">
        ${READ_RECEIPT_ICON}
        ${read_by.length >= 2 ? "Read" : "Delivered"}
      </div>
    `
      : "";

    // Profile photo
    let profilePhotoUrl = null;
    if (showHeader && !isCurrentUser) {
      profilePhotoUrl = await this.getUserProfilePhoto(username);
    }

    // Header with profile photo
    const headerHtml =
      showHeader && !isCurrentUser
        ? `
  <div class="flex items-center gap-2 mb-1 ml-2">
    ${
      profilePhotoUrl
        ? `
      <img src="${profilePhotoUrl}" 
           alt="${username}'s profile" 
           class="w-6 h-6 rounded-full object-cover border border-slate-200 dark:border-slate-600"
      >`
        : ""
    }
    <div class="text-xs font-bold text-slate-500 dark:text-slate-400">
      ${username}
    </div>
  </div>
`
        : "";

    // Reply 
    const replyClasses = isCurrentUser
      ? "bg-blue-400/70 dark:bg-blue-500/70 text-white"
      : "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200";

    // Enhanced reply preview
    let replyContent = "";
    if (reply_to) {
      if (reply_to.type === "image") {
        replyContent = `
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
        replyContent = `
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

    // Edited indicator
    const editedLabel = edited
      ? `<span class="text-xs opacity-60 ml-1" aria-label="Edited" title="Edited at ${new Date(
          timestamp
        ).toLocaleString()}">·</span>`
      : "";

    // Reactions
    const reactionsHtml =
      Object.entries(reactions || {}).length > 0
        ? `
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
    `
        : "";

    // Message actions 
    const messageActionsHtml = `
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
          ${
            isCurrentUser
              ? `
              <button class="edit-message-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 ${
                type === "image" ? "hidden" : ""
              }" aria-label="Edit" title="Edit">
                  <i class="fas fa-edit"></i>
              </button>
              <button class="delete-message-btn text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                      aria-label="Delete" title="Delete">
                  <i class="fas fa-trash"></i>
              </button>
          `
              : ""
          }
      </div>
    `;

    // Message content processing 
    let messageContent;
    let linkPreviewHtml = "";

    if (type === "image") {
      messageContent = `
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
    } else {
      const url = this.extractUrlFromText(content);
      // Apply word wrapping for long text
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

    // Determine the space class based on grouping
    const spacingClass = showHeader ? "mb-3" : "mb-1";

    return `
    <div class="flex ${
      isCurrentUser ? "justify-end" : "justify-start"
    } message relative ${spacingClass} group animate-fade-in" 
        data-message-id="${messageId}"
        data-username="${username}"
        data-type="${type}"
        data-timestamp="${messageDate.getTime()}">
        <div class="flex flex-col ${
          isCurrentUser ? "items-end" : "items-start"
        } max-w-[75%] sm:max-w-[85%] md:max-w-[75%] relative">
            ${headerHtml}
            <div class="message-container relative">
                ${replyContent}
                <div class="message-bubble px-4 py-2 ${bubbleShape} ${bubbleClasses} shadow-sm">
                    <div class="text-sm message-content">
                        ${messageContent}${editedLabel}
                    </div>
                </div>
                ${linkPreviewHtml}
                ${reactionsHtml}
            </div>
            
            ${messageActionsHtml}
            
            <div class="message-info text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-slate-400 dark:text-slate-500 flex items-center gap-1" 
                 aria-label="Message info">
                <span class="message-timestamp" title="${messageDate.toLocaleString()}">${timeDisplay}</span>
                ${readReceiptHtml}
            </div>
        </div>
    </div>
  `;
  }

  // Helper method to format message text with links, emojis, etc.
  formatMessageText(text) {
    if (!text) return "";

    // Remove zero-width spaces (&#8203;)
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

  // Helper methods for rendering message groups
  async renderMessageGroup(messages, currentUser) {
    if (!messages || messages.length === 0) return "";

    let html = "";
    let previousMessage = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const showHeader =
        i === 0 || message.username !== messages[i - 1].username;

      html += await this.createMessageHTML(
        message,
        showHeader,
        previousMessage
      );
      previousMessage = message;
    }

    return html;
  }
}

// Add style for fade-in animation and text wrapping
const style = document.createElement("style");
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
`;
document.head.appendChild(style);

export default MessageRenderer;
