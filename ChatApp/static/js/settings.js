import { getCurrentUser, logoutUser, waitForAuthReady } from "./auth.js";
import authAxios from "./authAxios.js";

document.addEventListener("DOMContentLoaded", async () => {
    const isAuthenticated = await waitForAuthReady();

    if (!isAuthenticated) {
      console.log("User not authenticated, redirecting to login");
      window.location.href = "/login";
      return;
    }
  // Set up logout functionality
  const logoutButton = document.getElementById("logoutButton");
  logoutButton.addEventListener("click", () => {
    logoutUser();
  });

  const cachedProfilePhotoKey = "cachedProfilePhoto";
  const profilePhotoImg = document.getElementById("currentProfilePhoto");

  // Load cached photo while waiting for fresh data
  const cachedPhoto = localStorage.getItem(cachedProfilePhotoKey);
  if (cachedPhoto) {
    profilePhotoImg.src = cachedPhoto;
  }

  try {
    // Get current user information
    const currentUser = getCurrentUser();
    const username = currentUser.displayName || currentUser.email.split("@")[0];

    // Get current profile photo using authAxios with the correct endpoint
    const photoResponse = await authAxios.get(`/users/${username}/profile-photo`);
    const photoUrl =
      photoResponse.data.profile_photo_url ||
      "/static/images/default-profile.png";

    profilePhotoImg.src = photoUrl;
    localStorage.setItem(cachedProfilePhotoKey, photoUrl);
  } catch (error) {
    console.error("Error fetching profile photo:", error);
  }

  // Handle profile photo upload
  const profilePhotoUpload = document.getElementById("profilePhotoUpload");
  profilePhotoUpload.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      // Use authAxios for upload
      const response = await authAxios.post("/users/profile-photo", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const newPhotoUrl = response.data.profile_photo_url;
      profilePhotoImg.src = newPhotoUrl;
      localStorage.setItem(cachedProfilePhotoKey, newPhotoUrl);

      alert("Profile photo updated successfully");
    } catch (error) {
      console.error("Error uploading photo:", error);
      alert(error.response?.data?.detail || "Failed to upload photo");
    }
  });

  // Form validation
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const usernameValidation = document.getElementById("usernameValidation");
  const passwordMatchValidation = document.getElementById(
    "passwordMatchValidation"
  );
  const passwordStrength = document.getElementById("passwordStrength");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // Username validation
  usernameInput.addEventListener("input", () => {
    const username = usernameInput.value.trim();
    if (username.length > 0 && (username.length < 3 || username.length > 20)) {
      usernameValidation.classList.remove("hidden");
    } else {
      usernameValidation.classList.add("hidden");
    }
    checkFormValidity();
  });

  // Password strength indicator
  passwordInput.addEventListener("input", () => {
    const password = passwordInput.value;
    let strength = "Weak";
    let strengthColor = "text-red-500";

    if (password.length >= 8) {
      if (
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password)
      ) {
        strength = "Strong";
        strengthColor = "text-green-500";
      } else if (password.length >= 12) {
        strength = "Medium";
        strengthColor = "text-yellow-500";
      }
    }

    passwordStrength.textContent = strength;
    passwordStrength.className = `text-sm ${strengthColor}`;
    checkFormValidity();
  });

  // Password matching validation
  confirmPasswordInput.addEventListener("input", () => {
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (password && confirmPassword && password !== confirmPassword) {
      passwordMatchValidation.classList.remove("hidden");
    } else {
      passwordMatchValidation.classList.add("hidden");
    }
    checkFormValidity();
  });

  // Form validation function
  function checkFormValidity() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    const isUsernameValid =
      username.length === 0 || (username.length >= 3 && username.length <= 20);
    const isPasswordValid =
      password.length === 0 ||
      (password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password));
    const isPasswordMatching = password === confirmPassword;

    saveSettingsBtn.disabled = !(
      isUsernameValid &&
      isPasswordValid &&
      isPasswordMatching &&
      (username.length > 0 || password.length > 0)
    );
  }

  // Form submission handler
  const settingsForm = document.getElementById("settingsForm");
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    try {
      // Update username in our backend
      if (username) {
        await authAxios.put("/users/settings", { username });
      }

      // Handle password update through Firebase
      if (password) {
        const user = getCurrentUser();
        if (user) {
          // Update Firebase password
          await user.updatePassword(password);
        } else {
          throw new Error("User not authenticated");
        }
      }

      alert("Settings updated successfully");

      // Reset form
      usernameInput.value = "";
      passwordInput.value = "";
      confirmPasswordInput.value = "";
      saveSettingsBtn.disabled = true;
    } catch (error) {
      console.error("Error updating settings:", error);
      alert(
        error.response?.data?.detail ||
          error.message ||
          "Failed to update settings"
      );
    }
  });
});

// Dark mode toggle functionality
document.addEventListener("DOMContentLoaded", function () {
  const darkModeToggle = document.getElementById("darkModeToggle");
  if (!darkModeToggle) return;

  let isDarkMode = localStorage.getItem("darkMode") === "dark";

  function updateDarkMode() {
    document.documentElement.classList.toggle("dark", isDarkMode);
    localStorage.setItem("darkMode", isDarkMode ? "dark" : "light");
  }

  // Initialize dark mode
  updateDarkMode();

  darkModeToggle.addEventListener("click", () => {
    isDarkMode = !isDarkMode;
    updateDarkMode();
  });
});
