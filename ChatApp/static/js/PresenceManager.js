class PresenceManager {
  constructor() {
    // Singleton pattern
    if (PresenceManager.instance) {
      return PresenceManager.instance;
    }
    PresenceManager.instance = this;

    // Constants
    this.STATES = {
      ACTIVE: "active",
      AWAY: "away",
      OFFLINE: "offline",
    };

    this.ACTIVITY_TIMEOUT = 60000; // 1 minute of inactivity = AWAY
    this.OFFLINE_TIMEOUT = 300000; // 5 minutes of inactivity = OFFLINE

    // Current user state
    this.currentStatus = this.STATES.ACTIVE;
    this.lastActiveTimestamp = new Date().toISOString();
    this.activityTimer = null;
    this.statusChangeCallbacks = new Set();
    this.isTabActive = !document.hidden;

    // Bind methods
    this.handleUserActivity = this.handleUserActivity.bind(this);
    this.checkActivityStatus = this.checkActivityStatus.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    // Setup listeners
    this.setupActivityListeners();
    this.startActivityChecker();
  }

  static getInstance() {
    if (!PresenceManager.instance) {
      return new PresenceManager();
    }
    return PresenceManager.instance;
  }

  setupActivityListeners() {
    // Track user activity
    const activityEvents = ["mousedown", "keydown", "touchstart", "mousemove"];
    activityEvents.forEach((event) => {
      document.addEventListener(event, this.handleUserActivity, {
        passive: true,
      });
    });

    // Track tab visibility
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  handleUserActivity() {
    this.lastActiveTimestamp = new Date().toISOString();

    // Only update if current status is not ACTIVE
    if (this.currentStatus !== this.STATES.ACTIVE && this.isTabActive) {
      this.updateStatus(this.STATES.ACTIVE);
    }
  }

  handleVisibilityChange() {
    this.isTabActive = !document.hidden;

    if (this.isTabActive) {
      // User has returned to the tab - mark as active
      this.lastActiveTimestamp = new Date().toISOString();
      this.updateStatus(this.STATES.ACTIVE);
    } else {
      // User has left the tab - mark as away
      this.updateStatus(this.STATES.AWAY);
    }
  }

  startActivityChecker() {
    this.activityTimer = setInterval(this.checkActivityStatus, 10000);
  }

  checkActivityStatus() {
    // Skip check if tab isn't active
    if (!this.isTabActive) return;

    const inactiveTime =
      Date.now() - new Date(this.lastActiveTimestamp).getTime();

    if (inactiveTime >= this.OFFLINE_TIMEOUT) {
      this.updateStatus(this.STATES.OFFLINE);
    } else if (inactiveTime >= this.ACTIVITY_TIMEOUT) {
      this.updateStatus(this.STATES.AWAY);
    }
  }

  updateStatus(newStatus) {
    // Avoid unnecessary updates
    if (this.currentStatus === newStatus) return;

    this.currentStatus = newStatus;
    this.notifyStatusChange();
  }

  notifyStatusChange() {
    const statusData = {
      status: this.currentStatus,
      last_active: this.lastActiveTimestamp,
    };

    this.statusChangeCallbacks.forEach((callback) => callback(statusData));
  }

  /**
   * Register a callback for status changes
   * @param {Function} callback - Function to call when status changes
   */
  onStatusChange(callback) {
    if (typeof callback === "function") {
      this.statusChangeCallbacks.add(callback);

      // Immediately notify new listeners of current status
      callback({
        status: this.currentStatus,
        last_active: this.lastActiveTimestamp,
      });
    }
  }

  /**
   * Remove a previously registered callback
   * @param {Function} callback - Function to remove from callbacks
   */
  offStatusChange(callback) {
    this.statusChangeCallbacks.delete(callback);
  }

  /**
   * Get current user presence state
   * @returns {Object} Current status and last active timestamp
   */
  getCurrentStatus() {
    return {
      status: this.currentStatus,
      last_active: this.lastActiveTimestamp,
    };
  }

  /**
   * Manually set status (useful for explicit user actions like "Set status to Away")
   * @param {string} status - New status to set
   */
  setManualStatus(status) {
    if (Object.values(this.STATES).includes(status)) {
      this.updateStatus(status);
    }
  }

  /**
   * Clean up all listeners and timers
   */
  cleanup() {
    // Remove event listeners
    const activityEvents = ["mousedown", "keydown", "touchstart", "mousemove"];
    activityEvents.forEach((event) => {
      document.removeEventListener(event, this.handleUserActivity);
    });
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );

    // Clear timer
    clearInterval(this.activityTimer);

    // Clear callbacks
    this.statusChangeCallbacks.clear();
  }
}

export default PresenceManager;
