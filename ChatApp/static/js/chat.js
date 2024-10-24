// Constants and DOM elements
const TYPING_TIMEOUT = 1000;
const messages = document.getElementById("messages");
const messageInput = document.getElementById("message");
const imageUpload = document.getElementById('image-upload');
const leaveRoomButton = document.getElementById("leave-room-btn");
const username = document.getElementById("username").value;
const unreadMessages = new Set();
const originalTitle = document.title;

// State variables
let replyingTo = null;
let isUserListVisible = false;
let typingTimeout;
let currentUser = null;
let typingUsers = new Set();
let lastReadMessageId = null;
let isTabActive = true;
let unreadCount = 0;
let hasMoreMessages = false;
let isLoadingMessages = false;
let oldestMessageId = null;

//Local Storage
const LS_KEYS = {
  UNREAD_COUNT: 'unreadCount',
  LAST_READ_MESSAGE_ID: 'lastReadMessageId',
  USERNAME: 'username',
};

var socketio = io({
  transports: ['websocket']  // Ensure only WebSocket is used
});

// Helper functions
const createTypingIndicator = () => {
  const typingIndicator = document.createElement("div");
  typingIndicator.className = "typing-indicator";
  typingIndicator.style.display = "none";
  messages.parentNode.insertBefore(typingIndicator, messages.nextSibling);
  return typingIndicator;
};

const updatePageTitle = () => {
  if (unreadCount > 0) {
    document.title = `(${unreadCount}) ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
  updateLocalStorage(LS_KEYS.UNREAD_COUNT, unreadCount.toString());
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    isTabActive = false;
  } else {
    isTabActive = true;
    if (unreadCount > 0) {
      markMessagesAsRead();
      unreadCount = 0;
      updatePageTitle();
    }
  }
};

// Load data from Local Storage
const loadFromLocalStorage = () => {
  unreadCount = parseInt(localStorage.getItem(LS_KEYS.UNREAD_COUNT) || '0');
  lastReadMessageId = localStorage.getItem(LS_KEYS.LAST_READ_MESSAGE_ID);
  currentUser = localStorage.getItem(LS_KEYS.USERNAME) || username;

  updatePageTitle();
};

// Save data to Local Storage
const saveToLocalStorage = () => {
  localStorage.setItem(LS_KEYS.UNREAD_COUNT, unreadCount.toString());
  localStorage.setItem(LS_KEYS.LAST_READ_MESSAGE_ID, lastReadMessageId);
  localStorage.setItem(LS_KEYS.USERNAME, currentUser);
};

// Update specific items in Local Storage
const updateLocalStorage = (key, value) => {
  localStorage.setItem(key, value);
};

document.addEventListener("visibilitychange", handleVisibilityChange);

const typingIndicator = createTypingIndicator();

const createMessageElement = (name, msg, image, messageId, replyTo, isEdited = false, reactions = {}, readBy = []) => {
  const isCurrentUser = name === currentUser;
  // Check if message has been read by others (excluding the sender)
  const isRead = readBy.some(reader => reader !== null && reader !== currentUser);

  const element = document.createElement("div");
  element.className = `message group flex ${isCurrentUser ? 'justify-end' : 'justify-start'} items-start space-x-3 px-4 py-2 hover:bg-gray-50/5 transition-colors duration-200`;

  // Profile photo section
  if (!isCurrentUser) {
    const profilePhotoContainer = document.createElement("div");
    profilePhotoContainer.className = "flex-shrink-0";
    const profilePhoto = document.createElement("img");
    profilePhoto.src = `/profile_photos/${name}`;
    profilePhoto.alt = `${name}'s profile`;
    profilePhoto.className = "w-8 h-8 rounded-full object-cover ring-2 ring-white dark:ring-gray-800 shadow-sm";
    profilePhoto.onerror = function() {
      this.src = '/static/images/default-profile.png';
    };
    profilePhotoContainer.appendChild(profilePhoto);
    element.appendChild(profilePhotoContainer);
  }

  const messageContainer = document.createElement("div");
  messageContainer.className = "relative max-w-[80%]";

  // Message header with name and time
  const messageHeader = document.createElement("div");
  messageHeader.className = `flex items-center gap-2 mb-1 ${isCurrentUser ? 'justify-end' : 'justify-start'}`;
  
  if (!isCurrentUser) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "text-sm font-medium text-gray-700 dark:text-gray-300";
    nameSpan.textContent = name;
    messageHeader.appendChild(nameSpan);
  }
  
  messageContainer.appendChild(messageHeader);

  // Message bubble
  const messageBubble = document.createElement("div");
  messageBubble.className = `relative p-3 rounded-lg shadow-sm transition-all duration-200 ${
    isCurrentUser 
      ? 'bg-blue-500 text-white' 
      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
  }`;
  messageBubble.dataset.messageId = messageId;

  // Add read status styling only for current user's messages that have been read
  if (isCurrentUser && isRead) {
    messageBubble.classList.add('ring-2', 'ring-purple-400', 'dark:ring-purple-500');
  }

  if (replyTo) {
    const replyInfo = document.createElement("div");
    replyInfo.className = `mb-2 text-sm rounded px-3 py-1 border-l-2 ${
      isCurrentUser
        ? 'bg-blue-600/50 border-blue-300'
        : 'bg-gray-200 dark:bg-gray-700 border-gray-400 dark:border-gray-500'
    }`;
    replyInfo.dataset.replyTo = replyTo.id;
    replyInfo.innerHTML = `<span class="opacity-75">Replying to:</span> ${replyTo.message}`;
    messageBubble.appendChild(replyInfo);
  }

  // Message content
  const messageContent = document.createElement("div");
  messageContent.className = "message-content break-words";
  messageContent.textContent = msg || "Sent an image";

  if (isEdited) {
    const editedIndicator = document.createElement("span");
    editedIndicator.className = "ml-2 text-xs opacity-75";
    editedIndicator.textContent = "(edited)";
    messageContent.appendChild(editedIndicator);
  }

  messageBubble.appendChild(messageContent);

  // Image handling
  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = "Uploaded image";
    img.className = "mt-2 max-w-full rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200";
    messageBubble.appendChild(img);
  }

  // Reactions display
  const reactionsContainer = document.createElement("div");
  reactionsContainer.className = "flex flex-wrap gap-1 mt-2";
  
  if (Object.keys(reactions).length > 0) {
    Object.entries(reactions).forEach(([emoji, reactionData]) => {
      if (reactionData.count > 0) {
        const reactionElement = createReactionElement(emoji, reactionData, messageId);
        reactionsContainer.appendChild(reactionElement);
      }
    });
  }
  
  messageBubble.appendChild(reactionsContainer);

  // Actions menu
  const actionsMenu = createActionsMenu(isCurrentUser);
  messageBubble.appendChild(actionsMenu);

  messageContainer.appendChild(messageBubble);
  element.appendChild(messageContainer);

  addEventListeners(messageBubble, messageId, msg);

  return element;
};

const createReactionElement = (emoji, reactionData, messageId) => {
  const element = document.createElement("button");
  element.className = `flex items-center space-x-1 text-xs rounded-full px-2 py-0.5 transition-colors ${
    reactionData.users.includes(currentUser)
      ? 'bg-gray-200 dark:bg-gray-700'
      : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
  }`;
  
  element.onclick = () => socketio.emit('toggle_reaction', { messageId, emoji });
  
  const emojiSpan = document.createElement("span");
  emojiSpan.textContent = emoji;
  
  const countSpan = document.createElement("span");
  countSpan.textContent = reactionData.count;
  
  element.appendChild(emojiSpan);
  element.appendChild(countSpan);
  
  return element;
};

const createActionsMenu = (isCurrentUser) => {
  const actionsMenu = document.createElement("div");
  actionsMenu.className = `actions-menu opacity-0 group-hover:opacity-100 absolute -top-8 ${
    isCurrentUser ? 'right-0' : 'left-0'
  } flex items-center space-x-1 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-1 transition-all duration-200 z-10`;

  const actions = [
    { 
      title: "React", 
      icon: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      className: "hover:bg-gray-100 dark:hover:bg-gray-700"
    },
    { 
      title: "Reply", 
      icon: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
      className: "hover:bg-gray-100 dark:hover:bg-gray-700"
    },
    { 
      title: "Edit", 
      icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
      onlyCurrentUser: true,
      className: "hover:bg-gray-100 dark:hover:bg-gray-700"
    },
    { 
      title: "Delete", 
      icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
      onlyCurrentUser: true,
      className: "hover:bg-red-100 dark:hover:bg-red-900 text-red-600"
    }
  ];

  actions.forEach(action => {
    if (!action.onlyCurrentUser || (action.onlyCurrentUser && isCurrentUser)) {
      const button = document.createElement("button");
      button.className = `action-btn p-1.5 rounded transition-colors duration-150 ${action.className}`;
      button.title = action.title;
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${action.icon}" />
        </svg>
      `;
      actionsMenu.appendChild(button);
    }
  });

  return actionsMenu;
};

// Updated styles
const styles = `
  .message {
    transition: background-color 0.2s ease;
  }
  
  .message:hover {
    background-color: rgba(0, 0, 0, 0.02);
  }

  .dark .message:hover {
    background-color: rgba(255, 255, 255, 0.02);
  }

  .message-content img {
    border-radius: 0.5rem;
    max-width: 100%;
    height: auto;
  }

  .actions-menu {
    transform: translateY(-0.5rem);
    pointer-events: none;
  }

  .message:hover .actions-menu {
    transform: translateY(0);
    pointer-events: auto;
  }

  .action-btn svg {
    transition: transform 0.2s ease;
  }

  .action-btn:hover svg {
    transform: scale(1.1);
  }

  .read-message {
    position: relative;
  }

  .read-message::after {
    content: '';
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: rgb(167, 139, 250);
    border: 2px solid white;
  }

  .dark .read-message::after {
    border-color: rgb(17, 24, 39);
  }
`;

document.head.insertAdjacentHTML('beforeend', `<style>${styles}</style>`);

const createReactionPicker = () => {
  const picker = document.createElement("div");
  picker.className = "reaction-picker absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 p-2 z-20";
  
  const commonEmojis = ['👍', '❤️', '😊', '🎉', '🤔', '👀', '🙌', '🔥'];
  
  const emojiContainer = document.createElement("div");
  emojiContainer.className = "flex space-x-1";
  
  commonEmojis.forEach(emoji => {
    const button = document.createElement("button");
    button.className = "hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-lg transition-colors duration-150";
    button.textContent = emoji;
    button.onclick = (e) => {
      e.stopPropagation();
      const messageId = picker.closest('[data-message-id]').dataset.messageId;
      socketio.emit('add_reaction', { messageId, emoji });
      picker.remove();
    };
    emojiContainer.appendChild(button);
  });
  
  picker.appendChild(emojiContainer);
  return picker;
};

const addEventListeners = (messageBubble, messageId, msg) => {
  const replyBtn = messageBubble.querySelector('button[title="Reply"]');
  const editBtn = messageBubble.querySelector('button[title="Edit"]');
  const deleteBtn = messageBubble.querySelector('button[title="Delete"]');
  const reactBtn = messageBubble.querySelector('button[title="React"]');

  if (replyBtn) {
    replyBtn.addEventListener('click', () => startReply(messageId, msg));
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => editMessage(messageId));
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteMessage(messageId));
  }

  if (reactBtn) {
    reactBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      // Remove any existing reaction pickers
      document.querySelectorAll('.reaction-picker').forEach(picker => picker.remove());
      const picker = createReactionPicker();
      messageBubble.appendChild(picker);
      
      // Close picker when clicking outside
      const closePickerOnClickOutside = (e) => {
        if (!picker.contains(e.target) && !reactBtn.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', closePickerOnClickOutside);
        }
      };
      setTimeout(() => document.addEventListener('click', closePickerOnClickOutside), 0);
    });
  }
};

const addMessageToDOM = (element) => {
  let messageContainer = messages.querySelector('.flex.flex-col');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.className = 'flex flex-col space-y-4 p-4';
    messages.appendChild(messageContainer);
  }
  
  // Always append new messages to the end of the container
  messageContainer.appendChild(element);
  
  messages.scrollTop = messages.scrollHeight;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const messageId = entry.target.getAttribute('data-message-id');
        if (unreadMessages.has(messageId)) {
          markMessagesAsRead();
        }
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 1.0 });

  observer.observe(element);
};

const scrollToMessage = (messageId) => {
  const targetMessage = document.querySelector(`[data-message-id="${messageId}"]`);
  if (targetMessage) {
    targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetMessage.style.backgroundColor = 'rgba(78, 70, 220, 0.1)';
    setTimeout(() => {
      targetMessage.style.backgroundColor = '';
    }, 2000);
  }
};

const startReply = (messageId, message) => {
  replyingTo = { id: messageId, message: message };
  messageInput.placeholder = `Replying to: ${message}`;
  messageInput.classList.add('replying');
  messageInput.focus();
};

const cancelReply = () => {
  replyingTo = null;
  messageInput.placeholder = "Type a message...";
  messageInput.classList.remove('replying');
};

const addReaction = (messageId, emoji) => {
  socketio.emit('add_reaction', { messageId, emoji });
};

socketio.on('update_reactions', (data) => {
  const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (!messageElement) return;

  const reactionsContainer = messageElement.querySelector('.reactions-container');
  if (!reactionsContainer) return;

  // Clear existing reactions
  reactionsContainer.innerHTML = '';

  // Add updated reactions
  Object.entries(data.reactions).forEach(([emoji, reactionData]) => {
    if (reactionData.count > 0) {
      const reactionElement = createReactionElement(emoji, reactionData, data.messageId);
      reactionsContainer.appendChild(reactionElement);
    }
  });
});

const editMessage = (messageId) => {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) return;
  
  const messageContent = messageElement.querySelector('.message-content');
  if (!messageContent) return;
  
  const currentText = messageContent.textContent;
  const isCurrentUser = messageElement.classList.contains('bg-indigo-600');

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = `rounded-md p-1 w-full ${
      isCurrentUser 
          ? 'bg-indigo-700 text-white placeholder-indigo-300 border border-indigo-400' 
          : 'bg-white text-gray-900 border border-gray-300'
  }`;
  
  messageContent.replaceWith(input);
  input.focus();

  const handleEdit = (event) => {
      if (event.key === 'Enter' || event.type === 'blur') {
          const newText = input.value.trim();
          if (newText !== '' && newText !== currentText) {
              socketio.emit('edit_message', { messageId, newText });
          }
          finishEdit(newText || currentText, isCurrentUser);
      } else if (event.key === 'Escape') {
          finishEdit(currentText, isCurrentUser);
      }
  };

  const finishEdit = (text, isCurrentUser) => {
      input.removeEventListener('keyup', handleEdit);
      input.removeEventListener('blur', handleEdit);

      const newMessageContent = document.createElement('div');
      newMessageContent.className = `message-content ${isCurrentUser ? 'text-white' : 'text-gray-900'}`;
      newMessageContent.textContent = text;
      
      input.replaceWith(newMessageContent);
  };

  input.addEventListener('keyup', handleEdit);
  input.addEventListener('blur', handleEdit);
};

const updateTypingIndicator = () => {
  const typingArray = Array.from(typingUsers);
  let typingText = '';

  if (typingArray.length === 1) {
    typingText = `${typingArray[0]} is typing...`;
  } else if (typingArray.length === 2) {
    typingText = `${typingArray[0]} and ${typingArray[1]} are typing...`;
  } else if (typingArray.length > 2) {
    typingText = `${typingArray[0]}, ${typingArray[1]}, and ${typingArray.length - 2} more are typing...`;
  }

  typingIndicator.textContent = typingText;
  typingIndicator.style.display = typingArray.length > 0 ? "block" : "none";
};

const deleteMessage = (messageId) => {
    if (confirm('Are you sure you want to delete this message?')) {
      socketio.emit('delete_message', { messageId });
    }
  };

const sendMessage = () => {
  const message = messageInput.value.trim();
  if (message === "") return;
  
  const messageData = { 
    data: message,
    replyTo: replyingTo
  };
  socketio.emit("message", messageData);
};

const leaveRoom = () => {
  const homeUrl = leaveRoomButton.getAttribute("data-home-url");
  window.location.href = homeUrl;
};

// Event listeners
messageInput.addEventListener("keyup", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  } else {
    socketio.emit("typing", { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socketio.emit("typing", { isTyping: false });
    }, TYPING_TIMEOUT);
  }
});

socketio.on('update_reactions', (data) => {
  const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (!messageElement) return;

  const reactionsContainer = messageElement.querySelector('.reactions-container');
  if (!reactionsContainer) return;

  // Clear existing reactions
  reactionsContainer.innerHTML = '';

  // Add updated reactions
  Object.entries(data.reactions).forEach(([emoji, reactionData]) => {
    if (reactionData.count > 0) {
      const reactionElement = createReactionElement(emoji, reactionData, data.messageId);
      reactionsContainer.appendChild(reactionElement);
    }
  });
});

// Update reactions when receiving socket event
socketio.on('update_reactions', (data) => {
  const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (!messageElement) return;

  const reactionsContainer = messageElement.querySelector('.reactions-container');
  reactionsContainer.innerHTML = '';

  Object.entries(data.reactions).forEach(([emoji, reactionData]) => {
    const isSelected = reactionData.users.includes(currentUser);
    const reactionElement = createReactionElement(emoji, reactionData.count, isSelected);
    reactionElement.onclick = () => {
      socketio.emit('add_reaction', { messageId: data.messageId, emoji });
    };
    reactionsContainer.appendChild(reactionElement);
  });
});

imageUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      socketio.emit("message", { data: "Sent an image", image: e.target.result });
    };
    reader.readAsDataURL(file);
  }
});

const handleReaction = (emoji, reactionsContainer) => {
  const existingReaction = reactionsContainer.querySelector(`span[data-emoji="${emoji}"]`);
  
  if (existingReaction) {
    let count = parseInt(existingReaction.getAttribute('data-count'));
    existingReaction.setAttribute('data-count', ++count);
    existingReaction.textContent = `${emoji} ${count}`;
  } else {
    const newReaction = document.createElement('span');
    newReaction.className = 'reaction';
    newReaction.setAttribute('data-emoji', emoji);
    newReaction.setAttribute('data-count', 1);
    newReaction.textContent = `${emoji} 1`;
    reactionsContainer.appendChild(newReaction);
  }
};

leaveRoomButton.addEventListener("click", leaveRoom);

const markMessagesAsRead = () => {
  if (isTabActive && unreadMessages.size > 0) {
    const messageIds = Array.from(unreadMessages);
    socketio.emit("mark_messages_read", { message_ids: messageIds });
    unreadMessages.clear();
    unreadCount = 0;
    updatePageTitle();
    lastReadMessageId = messageIds[messageIds.length - 1];
    updateLocalStorage(LS_KEYS.LAST_READ_MESSAGE_ID, lastReadMessageId);
  }
};

socketio.on("message", (data) => {
  const messageElement = createMessageElement(
    data.name, 
    data.message, 
    data.image, 
    data.id, 
    data.reply_to,
    data.edited || false,
    data.reactions || {}
  );
  addMessageToDOM(messageElement);

  if (data.name !== currentUser) {
    unreadMessages.add(data.id);
    if (isTabActive) {
      markMessagesAsRead();
    } else {
      unreadCount++;
      updatePageTitle();
    }
  }

  const replyInfo = messageElement.querySelector('.reply-info');
  if (replyInfo) {
    replyInfo.addEventListener('click', () => scrollToMessage(replyInfo.getAttribute('data-reply-to')));
  }

  if (data.name === currentUser) {
    messageInput.value = "";
    cancelReply();

    const editBtn = messageElement.querySelector('.edit-btn');
    const deleteBtn = messageElement.querySelector('.delete-btn');
    editBtn.addEventListener('click', () => editMessage(data.id));
    deleteBtn.addEventListener('click', () => deleteMessage(data.id));
  } else {
    const replyBtn = messageElement.querySelector('.reply-btn');
    replyBtn.addEventListener('click', () => startReply(data.id, data.message));
  }
});

socketio.on("messages_read", (data) => {
  const { reader, message_ids } = data;
  message_ids.forEach(id => {
    const messageElement = document.querySelector(`[data-message-id="${id}"]`);
    if (messageElement && reader !== currentUser) {
      messageElement.classList.add('read-message'); // Add a class for styling
    }
  });
});

socketio.on("chat_history", (data) => {
  const messageContainer = document.createElement('div');
  messageContainer.className = 'flex flex-col space-y-4 p-4';
  
  data.messages.forEach((message) => {
    const messageElement = createMessageElement(
      message.name, 
      message.message, 
      message.image, 
      message.id, 
      message.reply_to,
      message.edited || false,
      message.reactions || {}
    );
    messageContainer.appendChild(messageElement);

    // Fix: Check if read_by is an array and contains valid readers
    const validReaders = Array.isArray(message.read_by) ? 
      message.read_by.filter(reader => reader !== null) : [];

    if (message.name !== currentUser && !validReaders.includes(currentUser)) {
      unreadMessages.add(message.id);
    }

    // Fix: Only mark as read (purple) if there are actual readers besides the sender
    if (message.name === currentUser) {
      const hasBeenRead = validReaders.some(reader => 
        reader !== null && 
        reader !== currentUser
      );
      
      if (hasBeenRead) {
        messageElement.querySelector('.message-content').parentElement.style.backgroundColor = '#4E46DC';
      }
    }
  });
  
  messages.innerHTML = '';
  messages.appendChild(messageContainer);
  
  if (data.messages.length > 0) {
    oldestMessageId = data.messages[0].id;
  }
  
  hasMoreMessages = data.has_more;
  updateLoadMoreButton();
  
  markMessagesAsRead();
  
  messages.scrollTop = messages.scrollHeight;
});

socketio.on("more_messages", (data) => {
  const oldScrollHeight = messages.scrollHeight;
  let messageContainer = messages.querySelector('.flex.flex-col');
  
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.className = 'flex flex-col space-y-4 p-4';
    messages.appendChild(messageContainer);
  }
  
  const loadMoreBtn = document.getElementById('load-more-btn');
  const fragment = document.createDocumentFragment();
  
  data.messages.forEach((message) => {
    const messageElement = createMessageElement(
      message.name, 
      message.message, 
      message.image, 
      message.id, 
      message.reply_to,
      message.edited || false
    );
    fragment.appendChild(messageElement);

    // Fix: Check if read_by is an array and contains valid readers
    const validReaders = Array.isArray(message.read_by) ? 
      message.read_by.filter(reader => reader !== null) : [];

    if (message.name !== currentUser && !validReaders.includes(currentUser)) {
      unreadMessages.add(message.id);
    }

    // Fix: Only mark as read (purple) if there are actual readers besides the sender
    if (message.name === currentUser) {
      const hasBeenRead = validReaders.some(reader => 
        reader !== null && 
        reader !== currentUser
      );
      
      if (hasBeenRead) {
        messageElement.querySelector('.message-content').parentElement.style.backgroundColor = '#4E46DC';
      }
    }
  });
  
  if (loadMoreBtn) {
    loadMoreBtn.after(fragment);
  } else {
    messageContainer.insertBefore(fragment, messageContainer.firstChild);
  }
  
  if (data.messages.length > 0) {
    oldestMessageId = data.messages[0].id;
  }
  
  hasMoreMessages = data.has_more;
  updateLoadMoreButton();
  
  isLoadingMessages = false;
  
  const newScrollHeight = messages.scrollHeight;
  messages.scrollTop = newScrollHeight - oldScrollHeight + messages.scrollTop;
});

function createLoadMoreButton() {
  const button = document.createElement('button');
  button.id = 'load-more-btn';
  button.className = 'bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-4 mb-4 w-full';
  button.textContent = 'Load More Messages';
  button.addEventListener('click', loadMoreMessages);
  return button;
}

function updateLoadMoreButton() {
  let messageContainer = messages.querySelector('.flex.flex-col');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.className = 'flex flex-col space-y-4 p-4';
    messages.appendChild(messageContainer);
  }

  let existingButton = document.getElementById('load-more-btn');
  if (hasMoreMessages) {
    if (!existingButton) {
      existingButton = createLoadMoreButton();
      messageContainer.insertBefore(existingButton, messageContainer.firstChild);
    }
  } else {
    if (existingButton) {
      existingButton.remove();
    }
  }
}

function loadMoreMessages() {
  if (isLoadingMessages || !hasMoreMessages) return;
  
  isLoadingMessages = true;
  socketio.emit("load_more_messages", { last_message_id: oldestMessageId });
}

socketio.on("edit_message", (data) => {
  const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageElement) {
    const messageContainer = messageElement.querySelector('.message-content').parentElement;
    const isCurrentUser = messageElement.closest('.message').classList.contains('justify-end');
    
    // Update message content
    const messageContent = messageContainer.querySelector('.message-content');
    messageContent.textContent = data.newText;
    
    // Add edit indicator if not already present
    if (!messageContainer.querySelector('.edited-indicator')) {
      const editedIndicator = document.createElement("span");
      editedIndicator.className = `edited-indicator text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`;
      editedIndicator.textContent = "(edited)";
      messageContainer.appendChild(editedIndicator);
    }
  }
}); 
  
socketio.on("delete_message", (data) => {
  const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageElement) {
    messageElement.remove();
  }
});

socketio.on("typing", (data) => {
  if (data.isTyping) {
    typingUsers.add(data.name);
  } else {
    typingUsers.delete(data.name);
  }
  updateTypingIndicator();
});

socketio.on("connect", () => {
  console.log("Connected to server");
  currentUser = username;
});

socketio.on("disconnect", () => {
  console.log("Disconnected from server");
});

document.querySelector('.user-toggle-btn').addEventListener('click', () => {
  const userList = document.getElementById('user-list');
  const userCountLabel = document.getElementById('user-count-label');
  
  if (isUserListVisible) {
    userList.classList.add('hidden');
    userCountLabel.classList.remove('hidden');
  } else {
    userList.classList.remove('hidden');
    userCountLabel.classList.add('hidden');
  }
  
  isUserListVisible = !isUserListVisible;
});

// Call loadFromLocalStorage when the page loads
document.addEventListener('DOMContentLoaded', loadFromLocalStorage);

// Call saveToLocalStorage before the page unloads
window.addEventListener('beforeunload', saveToLocalStorage);