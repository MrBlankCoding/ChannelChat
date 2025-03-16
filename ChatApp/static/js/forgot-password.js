// forgot-password.js
import { resetPassword } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  const resetPasswordForm = document.getElementById("resetPasswordForm");
  const resetRequestContainer = document.getElementById(
    "resetRequestContainer"
  );
  const resetConfirmationContainer = document.getElementById(
    "resetConfirmationContainer"
  );
  const newPasswordContainer = document.getElementById("newPasswordContainer");
  const backToResetBtn = document.getElementById("backToResetBtn");
  const backToLoginBtn = document.getElementById("backToLoginBtn");
  const resetEmailError = document.getElementById("resetEmailError");
  const resetLoadingSpinner = document.getElementById("resetLoadingSpinner");
  const resetSubmitBtn = document.getElementById("resetSubmitBtn");

  // New password form elements
  const newPasswordForm = document.getElementById("newPasswordForm");
  const newPasswordError = document.getElementById("newPasswordError");
  const confirmPasswordError = document.getElementById("confirmPasswordError");
  const newPasswordStatus = document.getElementById("newPasswordStatus");

  // Check if this is a password reset link
  const checkForResetLink = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get("mode");
    const oobCode = urlParams.get("oobCode");

    if (mode === "resetPassword" && oobCode) {
      // Hide request form, show new password form
      resetRequestContainer.classList.add("hidden");
      resetConfirmationContainer.classList.add("hidden");
      newPasswordContainer.classList.remove("hidden");

      // Store the oob code to use when submitting
      newPasswordForm.setAttribute("data-oobcode", oobCode);
      return true;
    }
    return false;
  };

  // Call immediately on page load
  const isResetLink = checkForResetLink();

  // Handle password reset request form
  if (resetPasswordForm) {
    resetPasswordForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const resetEmail = document.getElementById("resetEmail").value;
      resetEmailError.classList.add("hidden");

      // Validate email
      if (!resetEmail || !/^\S+@\S+\.\S+$/.test(resetEmail)) {
        resetEmailError.textContent = "Please enter a valid email address.";
        resetEmailError.classList.remove("hidden");
        return;
      }

      // Show loading state
      resetSubmitBtn.disabled = true;
      resetLoadingSpinner.classList.remove("hidden");

      try {
        await resetPassword(resetEmail);

        // Show confirmation screen
        resetRequestContainer.classList.add("hidden");
        resetConfirmationContainer.classList.remove("hidden");
      } catch (error) {
        console.error("Reset password error:", error);

        // Handle different error scenarios
        if (error.code === "auth/user-not-found") {
          resetEmailError.textContent =
            "No account exists with this email address.";
        } else {
          resetEmailError.textContent =
            "Failed to send reset link. Please try again.";
        }
        resetEmailError.classList.remove("hidden");
      } finally {
        // Reset UI state
        resetSubmitBtn.disabled = false;
        resetLoadingSpinner.classList.add("hidden");
      }
    });
  }

  // Handle "try another email" button
  if (backToResetBtn) {
    backToResetBtn.addEventListener("click", () => {
      resetRequestContainer.classList.remove("hidden");
      resetConfirmationContainer.classList.add("hidden");
      document.getElementById("resetEmail").value = "";
      resetEmailError.classList.add("hidden");
    });
  }

  // Handle "back to login" button
  if (backToLoginBtn) {
    backToLoginBtn.addEventListener("click", () => {
      window.location.href = "/login";
    });
  }

  // Handle new password form submission
  if (newPasswordForm) {
    newPasswordForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const newPassword = document.getElementById("newPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;
      const oobCode = newPasswordForm.getAttribute("data-oobcode");

      // Reset error states
      newPasswordError.classList.add("hidden");
      confirmPasswordError.classList.add("hidden");

      // Validate password
      let isValid = true;

      if (!newPassword || newPassword.length < 8) {
        newPasswordError.textContent =
          "Password must be at least 8 characters.";
        newPasswordError.classList.remove("hidden");
        isValid = false;
      }

      if (newPassword !== confirmPassword) {
        confirmPasswordError.textContent = "Passwords do not match.";
        confirmPasswordError.classList.remove("hidden");
        isValid = false;
      }

      if (!isValid) return;

      // Show loading state
      document.getElementById("setPasswordBtn").disabled = true;

      try {
        // Import auth utils dynamically to avoid circular dependencies
        const { confirmPasswordReset } = await import("./auth.js");
        await confirmPasswordReset(oobCode, newPassword);

        // Show success message
        newPasswordStatus.textContent =
          "Password reset successful! You can now log in with your new password.";
        newPasswordStatus.className =
          "mt-4 p-3 rounded-md text-sm bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-200";
        newPasswordStatus.classList.remove("hidden");

        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = "/login";
        }, 3000);
      } catch (error) {
        console.error("Error setting new password:", error);

        // Handle specific error cases
        if (
          error.code === "auth/invalid-action-code" ||
          error.code === "auth/expired-action-code"
        ) {
          newPasswordStatus.textContent =
            "This password reset link has expired or is invalid. Please request a new one.";
        } else {
          newPasswordStatus.textContent =
            "Failed to reset password. Please try again or request a new reset link.";
        }

        newPasswordStatus.className =
          "mt-4 p-3 rounded-md text-sm bg-red-50 text-red-800 dark:bg-red-900 dark:text-red-200";
        newPasswordStatus.classList.remove("hidden");

        // Re-enable the button
        document.getElementById("setPasswordBtn").disabled = false;
      }
    });
  }
});
