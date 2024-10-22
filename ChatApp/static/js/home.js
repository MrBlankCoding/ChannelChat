document.addEventListener('DOMContentLoaded', function() {
    // Previous global variables and elements remain the same
    let friendToRemove = null;
    let roomToDelete = null;

    const elements = {
        friendSearch: document.getElementById('friends-search'),
        confirmButton: document.getElementById('confirmButton'),
        friendUsernameInput: document.getElementById('friend_username')
    };

    // =========================================
    // Unread Messages Management
    // =========================================
    function updateUnreadCounts() {
        fetch('/get_unread_messages')
            .then(response => response.json())
            .then(data => {
                for (const [roomId, roomData] of Object.entries(data)) {
                    const unreadElement = document.getElementById(`unread-${roomId}`);
                    if (unreadElement) {
                        unreadElement.textContent = roomData.unread_count;
                        unreadElement.classList.toggle('hidden', roomData.unread_count === 0);
                    }
                }
            })
            .catch(error => console.error('Error fetching unread messages:', error));
    }

    // Initialize unread counts
    updateUnreadCounts();
    setInterval(updateUnreadCounts, 30000);

    // =========================================
    // Tab Management
    // =========================================
    function switchTab(tab) {
        document.querySelectorAll('[id$="-tab"]').forEach(el => {
            el.classList.remove('tab-active');
        });
        document.querySelectorAll('.tab-content').forEach(el => {
            el.classList.add('hidden');
        });
        document.getElementById(`${tab}-tab`).classList.add('tab-active');
        document.getElementById(`${tab}-content`).classList.remove('hidden');
    }

    function switchFriendsTab(tab) {
        document.querySelectorAll('[id$="-tab"]').forEach(el => {
            el.classList.remove('friends-tab-active');
        });
        document.querySelectorAll('.friends-tab-content').forEach(el => {
            el.classList.add('hidden');
        });
        document.getElementById(`${tab}-tab`).classList.add('friends-tab-active');
        document.getElementById(`${tab}-content`).classList.remove('hidden');
    }


    // =========================================
    // Room Management
    // =========================================
    function showEditRoomName(roomCode) {
        const editForm = document.getElementById(`edit-room-name-${roomCode}`);
        editForm.classList.toggle('hidden');
    }

    function confirmDeleteRoom(roomCode) {
        roomToDelete = roomCode;
        showRoomDeleteModal();
    }

    function showRoomDeleteModal() {
        const modal = document.getElementById('roomDeleteModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('confirmRoomDelete').href = `/delete_room/${roomToDelete}`;
    }

    function hideRoomDeleteModal() {
        const modal = document.getElementById('roomDeleteModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        roomToDelete = null;
    }

    function toggleRoomInvites() {
        const content = document.getElementById('roomInvitesContent');
        content.classList.toggle('hidden');
    }

    // =========================================
    // User Search and Autocomplete
    // =========================================
    function initializeUserSearch() {
        const suggestionsList = document.createElement('ul');
        suggestionsList.className = 'absolute z-10 w-full bg-white dark:bg-gray-800 shadow-lg rounded-md mt-1 border border-gray-200 dark:border-gray-700 hidden max-h-64 overflow-y-auto';
        elements.friendUsernameInput?.parentNode.appendChild(suggestionsList);
        
        let debounceTimeout;
        
        function highlightMatch(username, query) {
            if (!query) return username;
            
            const lowerUsername = username.toLowerCase();
            const lowerQuery = query.toLowerCase();
            
            // First try to highlight exact matches
            const exactMatches = lowerUsername.indexOf(lowerQuery);
            if (exactMatches !== -1) {
                return username.substring(0, exactMatches) +
                       `<span class="bg-yellow-200 dark:bg-yellow-600">${username.substring(exactMatches, exactMatches + query.length)}</span>` +
                       username.substring(exactMatches + query.length);
            }
            
            // If no exact match, highlight first letter for single-character queries
            if (query.length === 1 && lowerUsername.startsWith(lowerQuery)) {
                return `<span class="bg-yellow-200 dark:bg-yellow-600">${username.charAt(0)}</span>${username.slice(1)}`;
            }
            
            return username;
        }
        
        function handleUserSearch(e) {
            clearTimeout(debounceTimeout);
            const query = e.target.value.trim();
        
            if (!query) {
                suggestionsList.innerHTML = '';
                suggestionsList.classList.add('hidden');
                return;
            }
        
            debounceTimeout = setTimeout(() => {
                fetch(`/search_users?q=${encodeURIComponent(query)}`)
                    .then(response => response.json())
                    .then(suggestions => {
                        suggestionsList.innerHTML = '';
        
                        if (suggestions.length > 0) {
                            suggestions.forEach(user => {
                                const li = document.createElement('li');
                                li.className = 'px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center justify-between';
        
                                const leftContent = document.createElement('div');
                                leftContent.className = 'flex items-center';
                                
                                // Create image element
                                const img = document.createElement('img');
                                img.src = user.profile_photo_url;
                                img.alt = user.username;
                                img.className = 'h-6 w-6 rounded-full mr-2';
                                
                                // Add onerror handler to handle failed image loads
                                img.onerror = function() {
                                    this.src = '/static/images/default_profile.png'; // Adjust path to your default image
                                };
        
                                const usernameSpan = document.createElement('span');
                                usernameSpan.className = 'text-gray-900 dark:text-white';
                                usernameSpan.innerHTML = highlightMatch(user.username, query);
        
                                leftContent.appendChild(img);
                                leftContent.appendChild(usernameSpan);
        
                                const matchScore = document.createElement('div');
                                matchScore.className = 'text-xs text-gray-500 dark:text-gray-400';
                                if (query.length > 1) {
                                    matchScore.textContent = `${user.similarity}% match`;
                                }
        
                                li.appendChild(leftContent);
                                li.appendChild(matchScore);
        
                                li.addEventListener('click', () => {
                                    elements.friendUsernameInput.value = user.username;
                                    suggestionsList.classList.add('hidden');
                                });
                                suggestionsList.appendChild(li);
                            });
                            suggestionsList.classList.remove('hidden');
                        } else {
                            // Show "no results" message
                            const li = document.createElement('li');
                            li.className = 'px-4 py-2 text-gray-500 dark:text-gray-400 text-sm';
                            li.textContent = query.length === 1 
                                ? `No usernames starting with "${query}"` 
                                : 'No matching users found';
                            suggestionsList.appendChild(li);
                            suggestionsList.classList.remove('hidden');
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching suggestions:', error);
                        suggestionsList.classList.add('hidden');
                    });
            }, 100); // Reduced debounce time for better responsiveness
        }

        function handleKeyboardNavigation(e) {
            const items = Array.from(suggestionsList.getElementsByTagName('li'));
            const currentIndex = items.findIndex(item => item.classList.contains('bg-gray-100'));
            
            switch(e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (items.length > 0) {
                        if (currentIndex >= 0) items[currentIndex].classList.remove('bg-gray-100');
                        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                        items[nextIndex].classList.add('bg-gray-100');
                        items[nextIndex].scrollIntoView({ block: 'nearest' });
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (items.length > 0) {
                        if (currentIndex >= 0) items[currentIndex].classList.remove('bg-gray-100');
                        const nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                        items[nextIndex].classList.add('bg-gray-100');
                        items[nextIndex].scrollIntoView({ block: 'nearest' });
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (currentIndex >= 0) {
                        items[currentIndex].click();
                    }
                    break;
            }
        }

        // Event Listeners for User Search
        elements.friendUsernameInput?.addEventListener('input', handleUserSearch);
        elements.friendUsernameInput?.addEventListener('keydown', handleKeyboardNavigation);
        
        // Hide suggestions when clicking outside
        document.addEventListener('click', function(e) {
            if (!elements.friendUsernameInput?.contains(e.target) && !suggestionsList.contains(e.target)) {
                suggestionsList.classList.add('hidden');
            }
        });
    }

    // =========================================
    // Event Listeners
    // =========================================
    elements.friendSearch?.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.friend-item').forEach(item => {
            const friendName = item.querySelector('.friend-name').textContent.toLowerCase();
            item.style.display = friendName.includes(searchTerm) ? 'block' : 'none';
        });
    });

    elements.confirmButton?.addEventListener('click', function() {
        if (friendToRemove) {
            window.location.href = `/remove_friend/${friendToRemove}`;
        }
    });

    // Initialize auto-hide for flash messages
    setTimeout(() => {
        const flashMessages = document.querySelectorAll('.animate-fade-in');
        flashMessages.forEach(message => {
            message.style.animation = 'fadeOut 0.3s ease-in-out forwards';
            setTimeout(() => message.remove(), 300);
        });
    }, 5000);

    // Initialize user search functionality
    initializeUserSearch();

    // Make functions globally accessible if needed
    window.switchTab = switchTab;
    window.switchFriendsTab = switchFriendsTab;
    window.removeFriend = removeFriend;
    window.showEditRoomName = showEditRoomName;
    window.confirmDeleteRoom = confirmDeleteRoom;
    window.showRoomDeleteModal = showRoomDeleteModal;
    window.hideRoomDeleteModal = hideRoomDeleteModal;
    window.toggleRoomInvites = toggleRoomInvites;
});