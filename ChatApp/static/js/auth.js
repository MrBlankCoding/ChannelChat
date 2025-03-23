import { initFirebase } from "./firebaseConfig.js";

// State variables
let auth;
let authUtils;
let currentUser = null;
let authStatePromise = null;
let authInitialized = false;

// Token caching
let cachedToken = null;
let tokenExpiryTime = null;
const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds

// Initialize Firebase Auth
export const initAuth = async () => {
  // If auth is already initializing, return the existing promise
  if (authStatePromise) {
    return authStatePromise;
  }

  // Create a new promise for auth initialization
  authStatePromise = new Promise(async (resolve, reject) => {
    try {
      // Get Firebase instance with auth already initialized
      const firebase = await initFirebase();
      auth = firebase.auth;
      authUtils = firebase.authUtils;

      // Check if user wants to be remembered - default to true for PWA
      const rememberMe = localStorage.getItem("rememberMe") !== "false";

      // Set persistence based on remember me preference
      // For PWA, we want local persistence by default
      if (rememberMe) {
        await authUtils.setPersistence(auth, authUtils.browserLocalPersistence);
      } else {
        // Only use session persistence if explicitly not remembered
        await authUtils.setPersistence(
          auth,
          authUtils.browserSessionPersistence
        );
      }

      // Set up auth state listener
      authUtils.onAuthStateChanged(auth, async (user) => {
        const wasLoggedIn = !!currentUser;
        const isLoggedIn = !!user;
        currentUser = user;

        if (user) {
          console.log("User is signed in");
          // Update UI based on authenticated state
          updateAuthUI(true);

          // Store authentication state
          localStorage.setItem("isAuthenticated", "true");

          // Store user info in localStorage for quick access
          localStorage.setItem("userId", user.uid);
          localStorage.setItem("userEmail", user.email);
          if (user.displayName) {
            localStorage.setItem("userName", user.displayName);
          }

          // Clear token cache on user change to force refresh
          clearTokenCache();
        } else {
          console.log("User is signed out");
          // Update UI based on unauthenticated state
          updateAuthUI(false);

          // Clear authentication state
          localStorage.removeItem("isAuthenticated");
          localStorage.removeItem("userId");
          localStorage.removeItem("userEmail");
          localStorage.removeItem("userName");
          clearTokenCache();
        }

        // If auth state changed, trigger custom event
        if (wasLoggedIn !== isLoggedIn) {
          window.dispatchEvent(
            new CustomEvent("authStateChanged", {
              detail: { isAuthenticated: isLoggedIn },
            })
          );
        }
      });

      authInitialized = true;
      resolve({ auth, authUtils });
    } catch (error) {
      console.error("Error initializing auth:", error);
      authStatePromise = null;
      reject(error);
    }
  });

  return authStatePromise;
};

// Clear token cache
export const clearTokenCache = () => {
  cachedToken = null;
  tokenExpiryTime = null;
};

// Register a new user
export const registerUser = async (email, password, username) => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    // Create user in Firebase Auth
    const userCredential = await authUtils.createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    // Update display name (username)
    await authUtils.updateProfile(user, {
      displayName: username,
    });

    // Get ID token for backend authentication
    const idToken = await user.getIdToken();

    // Create user in backend database using the authAxios instance
    // Import at the top would create circular dependency, so import here
    const { default: authAxios } = await import("./authAxios.js");

    await authAxios.post("/users", {
      firebase_uid: user.uid,
      email: user.email,
      username: username,
    });

    // Send email verification
    await authUtils.sendEmailVerification(user);

    // Set rememberMe to true by default for new users
    localStorage.setItem("rememberMe", "true");

    return user;
  } catch (error) {
    console.error("Registration error:", error);
    throw error;
  }
};

// Log in existing user
export const loginUser = async (email, password) => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    // Get rememberMe preference before login - default to true for PWA
    const rememberMe = localStorage.getItem("rememberMe") !== "false";

    // Set persistence based on rememberMe preference
    if (rememberMe) {
      await authUtils.setPersistence(auth, authUtils.browserLocalPersistence);
    } else {
      await authUtils.setPersistence(auth, authUtils.browserSessionPersistence);
    }

    const userCredential = await authUtils.signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    clearTokenCache(); // Clear cache on login

    // Store credentials in localStorage for PWA offline access
    if (rememberMe) {
      localStorage.setItem("lastLoginEmail", email);
    }

    return userCredential.user;
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
};

// Log out user
export const logoutUser = async () => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    clearTokenCache(); // Clear cache on logout

    // Clear PWA-specific stored data
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("userId");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userName");

    // Keep rememberMe preference unless explicitly set to false

    await authUtils.signOut(auth);
    window.location.href = "/login"; // Redirect to login page
  } catch (error) {
    console.error("Logout error:", error);
    throw error;
  }
};

// Reset password
export const resetPassword = async (email) => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    // Set language if needed
    const actionCodeSettings = {
      url: window.location.origin + "/forgot-password", // Redirect back to the password reset page
      handleCodeInApp: false,
    };

    await authUtils.sendPasswordResetEmail(auth, email, actionCodeSettings);
    return true;
  } catch (error) {
    console.error("Password reset error:", error);
    throw error;
  }
};

export const confirmPasswordReset = async (actionCode, newPassword) => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    await authUtils.confirmPasswordReset(auth, actionCode, newPassword);
    return true;
  } catch (error) {
    console.error("Password reset confirmation error:", error);
    throw error;
  }
};

export const verifyPasswordResetCode = async (actionCode) => {
  if (!authInitialized) {
    await initAuth();
  }

  try {
    // Returns the email address if successful
    const email = await authUtils.verifyPasswordResetCode(auth, actionCode);
    return email;
  } catch (error) {
    console.error("Password reset code verification error:", error);
    throw error;
  }
};

// Get current user
export const getCurrentUser = () => {
  if (currentUser) {
    return currentUser;
  }

  // If no current user but we have stored auth data, try to use that
  if (localStorage.getItem("isAuthenticated") === "true" && auth) {
    return auth.currentUser;
  }

  return null;
};

// Get authentication token for API requests with caching
export const getAuthToken = async (forceRefresh = false) => {
  // Try to get the current user
  const user = getCurrentUser();
  if (!user) return null;

  const now = Date.now();

  // If force refresh is not requested and we have a valid cached token
  if (
    !forceRefresh &&
    cachedToken &&
    tokenExpiryTime &&
    now < tokenExpiryTime - TOKEN_REFRESH_THRESHOLD
  ) {
    return cachedToken;
  }

  try {
    const token = await user.getIdToken(forceRefresh);

    if (token) {
      // Cache the token and set its expiry time
      cachedToken = token;

      // Decode JWT to get expiration time
      const payloadBase64 = token.split(".")[1];
      const payload = JSON.parse(atob(payloadBase64));
      tokenExpiryTime = payload.exp * 1000; // Convert to milliseconds

      // Store token expiry for PWA offline access
      localStorage.setItem("tokenExpiry", tokenExpiryTime);
    }

    return token;
  } catch (error) {
    console.error("Error getting auth token:", error);
    clearTokenCache();
    return null;
  }
};

// Create authorization header for API requests
export const createAuthHeader = async () => {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Check if user is authenticated
export const isAuthenticated = () => {
  // First check current user in memory
  if (!!currentUser) return true;

  // If no current user in memory but auth not initialized, check localStorage
  if (localStorage.getItem("isAuthenticated") === "true") {
    return true;
  }

  return false;
};

// Auto login from stored credentials for PWA
export const tryAutoLogin = async () => {
  // Check if we have stored auth data
  if (localStorage.getItem("isAuthenticated") === "true" && auth?.currentUser) {
    try {
      // Force token refresh to verify validity
      await getAuthToken(true);
      return true;
    } catch (error) {
      console.error("Auto login failed:", error);
      // Clear invalid auth data
      localStorage.removeItem("isAuthenticated");
      return false;
    }
  }
  return false;
};

// Update UI based on authentication state
const updateAuthUI = (isAuthed) => {
  const authLinks = document.querySelectorAll(".auth-link");
  const profileLinks = document.querySelectorAll(".profile-link");

  if (isAuthed) {
    // User is signed in
    authLinks.forEach((link) => link.classList.add("hidden"));
    profileLinks.forEach((link) => link.classList.remove("hidden"));

    // Update user info display if exists
    const userDisplayName = document.getElementById("userDisplayName");
    if (userDisplayName && currentUser) {
      userDisplayName.textContent =
        currentUser.displayName || currentUser.email;
    }

    // Update user avatar if exists
    const userAvatar = document.getElementById("userAvatar");
    if (userAvatar && currentUser && currentUser.photoURL) {
      userAvatar.src = currentUser.photoURL;
      userAvatar.alt = currentUser.displayName || "User avatar";
    }
  } else {
    // User is signed out
    authLinks.forEach((link) => link.classList.remove("hidden"));
    profileLinks.forEach((link) => link.classList.add("hidden"));
  }
};

// Improved waitForAuthReady function with timeout option
export const waitForAuthReady = (timeout = 5000) => {
  return new Promise(async (resolve) => {
    // Check if auth is not initialized yet
    if (!authInitialized) {
      try {
        await initAuth();
      } catch (error) {
        console.error("Auth initialization failed:", error);
        resolve(false);
        return;
      }
    }

    // Try auto login for PWA persistence
    await tryAutoLogin();

    // If already authenticated with a user, resolve after verifying token
    if (currentUser) {
      try {
        await getAuthToken(true); // Force token refresh
        resolve(true);
        return; // Return early to avoid setting up timeout
      } catch (err) {
        console.error("Error refreshing token:", err);
        resolve(false);
        return;
      }
    }

    // Set up a timeout ID that we can clear
    let timeoutId;

    // Set up a one-time auth state changed listener
    const unsubscribe = authUtils.onAuthStateChanged(auth, async (user) => {
      // Clear the timeout since auth state has changed
      clearTimeout(timeoutId);
      unsubscribe(); // Remove the listener immediately

      if (user) {
        try {
          // Ensure we have a fresh token
          await getAuthToken(true);
          resolve(true);
        } catch (error) {
          console.error("Token verification failed:", error);
          resolve(false);
        }
      } else {
        // No user, definitely logged out
        resolve(false);
      }
    });

    // Set timeout to resolve if auth state takes too long
    timeoutId = setTimeout(() => {
      console.log("Auth state timeout reached");
      unsubscribe();
      resolve(false);
    }, timeout);
  });
};

// Handle protected pages with improved reliability
export const protectPage = async () => {
  // First check for stored authentication
  if (isAuthenticated()) {
    // Now verify with waitForAuthReady for security
    const isAuthed = await waitForAuthReady(3000);

    if (!isAuthed) {
      // Try auto login for PWA
      const autoLoginSuccess = await tryAutoLogin();
      if (!autoLoginSuccess) {
        // Save current URL to redirect back after login
        sessionStorage.setItem("redirectUrl", window.location.pathname);
        window.location.href = "/login";
        return false;
      }
    }
    return true;
  }

  // If no stored auth, redirect to login
  sessionStorage.setItem("redirectUrl", window.location.pathname);
  window.location.href = "/login";
  return false;
};

// Initialize auth on page load
export const initializeOnPageLoad = () => {
  document.addEventListener("DOMContentLoaded", async () => {
    await initAuth();
    // Try auto login for PWA support
    await tryAutoLogin();
  });
};

// Initialize auth immediately when this module is imported for PWA
initAuth().catch((err) => console.error("Auth initialization error:", err));

// Redirect to intended destination after login
export const redirectAfterLogin = () => {
  const redirectUrl = sessionStorage.getItem("redirectUrl") || "/chat";
  sessionStorage.removeItem("redirectUrl");
  window.location.href = redirectUrl;
};
