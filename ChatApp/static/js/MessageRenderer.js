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
    this.LINKPREVIEW_API_KEY = "1c04df7c16f6df68d9c4d8fb66c68a2e";
    this.LINKPREVIEW_API_URL = "https://api.linkpreview.net/";
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
        .then((response) => response.json())
        .then((data) => data.profile_photo_url)
        .catch((error) => {
          console.error("Failed to fetch profile photo:", error);
          return null;
        });

      this.profilePhotoCache.set(username, photoPromise);
      return await photoPromise;
    } catch (error) {
      console.error("Unexpected error in getUserProfilePhoto:", error);
      return null;
    }
  }

  async fetchLinkPreview(url) {
    try {
      const apiUrl = new URL(this.LINKPREVIEW_API_URL);
      apiUrl.searchParams.append("key", this.LINKPREVIEW_API_KEY);
      apiUrl.searchParams.append("q", url);

      const response = await fetch(apiUrl.toString(), {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch link preview: ${response.status}`);
      }

      const data = await response.json();
      return {
        url: data.url,
        title: data.title,
        description: data.description,
        image: data.image ? data.image.replace("http:", "https:") : null,
        favicon: data.favicon
          ? data.favicon.replace("http:", "https:")
          : `https://www.google.com/s2/favicons?domain=${
              new URL(data.url).hostname
            }`,
      };
    } catch (error) {
      console.error("Error fetching link preview:", error);
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

    return `
      <a href="${previewData.url}" target="_blank" rel="noopener noreferrer" 
         class="link-preview mt-2 block border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200">
        <div class="flex flex-col">
          ${
            previewData.image
              ? `<img src="${previewData.image}" 
             class="w-full h-48 object-cover" 
             alt="${previewData.title}"
             loading="lazy">`
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

  async createMessageElement(message, showHeader = true) {
    const template = document.createElement("template");
    const messageHTML = await this.createMessageHTML(message, showHeader);
    template.innerHTML = messageHTML.trim();
    return template.content.firstChild;
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
    showHeader = true
  ) {
    const messageDate = new Date(timestamp);
    const messageId = id || `temp-${Date.now()}`;
    const isCurrentUser = this.currentUser?.username === username;
    const timeDisplay = this.formatTimeDisplay(messageDate);

    // Instagram-style message styling
    const bubbleClasses = isCurrentUser
      ? "bg-blue-500 dark:bg-blue-600 text-white"
      : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200";

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
      }">
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
        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">
          ${username}
        </div>
      </div>
    `
        : "";

    // Reply styles
    const replyClasses = isCurrentUser
      ? "bg-blue-400/70 dark:bg-blue-500/70 text-white"
      : "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200";

    const replyContent = reply_to
      ? `
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
    `
      : "";

    // Edited indicator
    const editedLabel = edited
      ? `<span class="text-xs opacity-60 ml-1" aria-label="Edited">·</span>`
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
          border border-slate-100 dark:border-slate-700 flex items-center z-10">
        ${Object.entries(reactions || {})
          .map(
            ([emoji, users]) => `
            <div class="emoji-reaction inline-flex items-center mx-0.5 text-sm" title="${users.join(
              ", "
            )}">
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

    // Message content processing
    let messageContent;
    let linkPreviewHtml = "";

    if (type === "image") {
      messageContent = `
        <div class="message-image-container relative">
          <img src="${this.escapeHtml(content)}" 
               alt="Shared image" 
               class="rounded-lg w-full max-w-xs object-cover cursor-pointer hover:opacity-90 transition-opacity"
               loading="lazy">
          <div class="absolute bottom-0 right-0 p-1 bg-black/50 rounded-bl-lg rounded-tr-lg text-white text-xs">
            <i class="fas fa-search-plus"></i>
          </div>
        </div>
      `;
    } else {
      const url = this.extractUrlFromText(content);
      messageContent = `<div class="break-words">${
        this.formatMessageText
          ? this.formatMessageText(content)
          : this.escapeHtml(content)
      }</div>`;

      if (url) {
        linkPreviewHtml = await this.generateLinkPreviewHTML(url);
      }
    }

    return `
    <div class="flex ${
      isCurrentUser ? "justify-end" : "justify-start"
    } message relative mb-3 group" 
        data-message-id="${messageId}"
        data-username="${username}"
        data-type="${type}"
        data-timestamp="${messageDate.getTime()}">
        <div class="flex flex-col ${
          isCurrentUser ? "items-end" : "items-start"
        } max-w-[75%] relative">
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
            
            <div class="message-actions absolute -top-7 ${
              isCurrentUser ? "right-0" : "left-0"
            } 
                opacity-0 group-hover:opacity-100 transition-opacity duration-200 
                bg-white dark:bg-slate-800 rounded-full shadow-lg px-2 py-1 flex gap-2 z-20">
                <button class="reaction-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                        aria-label="Add Reaction">
                    <i class="fas fa-smile"></i>
                </button>
                <button class="reply-message-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                        aria-label="Reply">
                    <i class="fas fa-reply"></i>
                </button>
                ${
                  isCurrentUser
                    ? `
                    <button class="edit-message-btn text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 ${
                      type === "image" ? "hidden" : ""
                    }" aria-label="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-message-btn text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" 
                            aria-label="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                `
                    : ""
                }
            </div>
            
            <div class="message-info text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-slate-400 dark:text-slate-500 flex items-center gap-1" 
                 aria-label="Message info">
                <span class="message-timestamp" title="${messageDate.toLocaleString()}">${timeDisplay}</span>
                ${readReceiptHtml}
            </div>
        </div>
    </div>
  `;
  }
}

export default MessageRenderer;
