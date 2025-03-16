// login.js
import { loginUser, redirectAfterLogin } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const rememberMeCheckbox = document.getElementById("rememberMe");
  const emailError = document.getElementById("emailError");
  const passwordError = document.getElementById("passwordError");
  const submitBtn = document.getElementById("submitBtn");
  const loadingSpinner = document.getElementById("loadingSpinner");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  // Check if we need to show the forgot password form
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("reset") === "password") {
    document.getElementById("loginContainer").classList.add("hidden");
    document
      .getElementById("resetPasswordContainer")
      .classList.remove("hidden");
  }

  // Load remembered email if available
  const rememberedEmail = localStorage.getItem("rememberedEmail");
  if (rememberedEmail) {
    emailInput.value = rememberedEmail;
    rememberMeCheckbox.checked = true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Reset error messages
    emailError.classList.add("hidden");
    passwordError.classList.add("hidden");

    // Validate inputs
    let isValid = true;

    if (!emailInput.value.trim()) {
      emailError.textContent = "Email is required.";
      emailError.classList.remove("hidden");
      isValid = false;
    } else if (!/^\S+@\S+\.\S+$/.test(emailInput.value)) {
      emailError.textContent = "Please enter a valid email address.";
      emailError.classList.remove("hidden");
      isValid = false;
    }

    if (!passwordInput.value) {
      passwordError.textContent = "Password is required.";
      passwordError.classList.remove("hidden");
      isValid = false;
    }

    if (!isValid) return;

    // Show loading state
    submitBtn.disabled = true;
    loadingSpinner.classList.remove("hidden");

    try {
      // Attempt login
      const user = await loginUser(emailInput.value, passwordInput.value);

      // Handle remember me functionality
      if (rememberMeCheckbox.checked) {
        localStorage.setItem("rememberedEmail", emailInput.value);
        // Set a flag that the user wants to be remembered
        localStorage.setItem("rememberMe", "true");
      } else {
        // Clear any previously remembered data
        localStorage.removeItem("rememberedEmail");
        localStorage.removeItem("rememberMe");
      }

      // Redirect user to the appropriate page
      redirectAfterLogin();
    } catch (error) {
      // Handle specific Firebase auth errors
      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password"
      ) {
        emailError.textContent = "Invalid email or password.";
        emailError.classList.remove("hidden");
      } else if (error.code === "auth/too-many-requests") {
        emailError.textContent =
          "Too many failed login attempts. Please try again later.";
        emailError.classList.remove("hidden");
      } else {
        console.error("Login error:", error);
        emailError.textContent =
          "An error occurred during login. Please try again.";
        emailError.classList.remove("hidden");
      }
    } finally {
      // Reset UI state
      submitBtn.disabled = false;
      loadingSpinner.classList.add("hidden");
    }
  });

  // Handle forgot password link
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = "/login?reset=password";
    });
  }

  // Handle reset password form if it exists
  const resetForm = document.getElementById("resetPasswordForm");
  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const resetEmail = document.getElementById("resetEmail").value;
      const resetStatus = document.getElementById("resetStatus");

      if (!resetEmail || !/^\S+@\S+\.\S+$/.test(resetEmail)) {
        resetStatus.textContent = "Please enter a valid email address.";
        resetStatus.className = "text-sm text-red-600 mt-2";
        return;
      }

      try {
        const { resetPassword } = await import("./auth.js");
        await resetPassword(resetEmail);

        resetStatus.textContent = "Password reset link sent to your email.";
        resetStatus.className = "text-sm text-green-600 mt-2";
      } catch (error) {
        console.error("Reset password error:", error);
        resetStatus.textContent =
          "Failed to send reset link. Please try again.";
        resetStatus.className = "text-sm text-red-600 mt-2";
      }
    });
  }
});
