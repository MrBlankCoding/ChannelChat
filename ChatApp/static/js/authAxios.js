import { getAuthToken, logoutUser } from "./auth.js";

// Token cache management
let cachedToken = null;
let tokenExpiryTime = null;
const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds

// Create an axios instance for authenticated requests
const authAxios = axios.create();

// Function to get a valid token (from cache or refresh if needed)
const getValidToken = async () => {
  const now = Date.now();

  // If we have a cached token that's not expiring soon, use it
  if (
    cachedToken &&
    tokenExpiryTime &&
    now < tokenExpiryTime - TOKEN_REFRESH_THRESHOLD
  ) {
    return cachedToken;
  }

  // Otherwise get a fresh token
  try {
    const token = await getAuthToken();

    if (token) {
      // Cache the token and set its expiry time
      // Firebase tokens typically last 1 hour, but we'll decode to be sure
      cachedToken = token;

      // Decode JWT to get expiration time
      const payloadBase64 = token.split(".")[1];
      const payload = JSON.parse(atob(payloadBase64));
      tokenExpiryTime = payload.exp * 1000; // Convert to milliseconds
    }

    return token;
  } catch (error) {
    console.error("Error getting fresh auth token:", error);
    cachedToken = null;
    tokenExpiryTime = null;
    return null;
  }
};

// Clear token cache (useful after logout)
export const clearTokenCache = () => {
  cachedToken = null;
  tokenExpiryTime = null;
};

// Add auth token to requests
authAxios.interceptors.request.use(
  async (config) => {
    const token = await getValidToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      console.warn("No auth token available for request");
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 responses (unauthorized) and other errors
authAxios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Handle unauthorized errors (401)
    if (
      error.response &&
      error.response.status === 401 &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        // Clear token cache to force refresh
        clearTokenCache();

        // Try to get a fresh token
        const newToken = await getAuthToken();

        if (newToken) {
          // Update the failed request with the new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          // Retry the original request
          return authAxios(originalRequest);
        } else {
          // If we couldn't get a new token, redirect to login
          console.warn("Authentication failed, redirecting to login");
          logoutUser();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
        logoutUser();
        return Promise.reject(refreshError);
      }
    }

    // For all other errors, just reject the promise
    return Promise.reject(error);
  }
);

export default authAxios;
