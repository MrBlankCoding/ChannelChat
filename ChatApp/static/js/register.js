// register.js
import { registerUser, redirectAfterLogin } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  const registerForm = document.getElementById("registerForm");
  const emailInput = document.getElementById("email");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const emailError = document.getElementById("emailError");
  const usernameError = document.getElementById("usernameError");
  const passwordError = document.getElementById("passwordError");
  const confirmPasswordError = document.getElementById("confirmPasswordError");
  const recaptchaError = document.getElementById("recaptchaError");
  const submitBtn = document.getElementById("submitBtn");
  const loadingSpinner = document.getElementById("loadingSpinner");

  // Site key for reCAPTCHA
  const RECAPTCHA_SITE_KEY = "6Lf_V-8qAAAAADWT624F6vgKJO54_K8GN5tj9fgs";

  // Form submission
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Reset error messages
    emailError.classList.add("hidden");
    usernameError.classList.add("hidden");
    passwordError.classList.add("hidden");
    confirmPasswordError.classList.add("hidden");
    recaptchaError.classList.add("hidden");

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

    if (!usernameInput.value.trim()) {
      usernameError.textContent = "Username is required.";
      usernameError.classList.remove("hidden");
      isValid = false;
    } else if (usernameInput.value.length < 3) {
      usernameError.textContent = "Username must be at least 3 characters.";
      usernameError.classList.remove("hidden");
      isValid = false;
    }

    if (!passwordInput.value) {
      passwordError.textContent = "Password is required.";
      passwordError.classList.remove("hidden");
      isValid = false;
    } else if (passwordInput.value.length < 6) {
      passwordError.textContent = "Password must be at least 6 characters.";
      passwordError.classList.remove("hidden");
      isValid = false;
    }

    if (
      confirmPasswordInput &&
      passwordInput.value !== confirmPasswordInput.value
    ) {
      confirmPasswordError.textContent = "Passwords do not match.";
      confirmPasswordError.classList.remove("hidden");
      isValid = false;
    }

    if (!isValid) return;

    // Show loading state
    submitBtn.disabled = true;
    loadingSpinner.classList.remove("hidden");

    try {
      // Execute reCAPTCHA with action 'register'
      const token = await executeRecaptcha("register");

      // Verify reCAPTCHA token on the server side
      const recaptchaVerified = await verifyRecaptchaToken(token);

      if (!recaptchaVerified) {
        throw new Error("recaptcha-failed");
      }

      // Attempt registration
      const user = await registerUser(
        emailInput.value,
        passwordInput.value,
        usernameInput.value
      );

      // Show verification message or redirect
      if (document.getElementById("verificationMessage")) {
        document.getElementById("registerContainer").classList.add("hidden");
        document
          .getElementById("verificationMessage")
          .classList.remove("hidden");
      } else {
        // Redirect user to the appropriate page
        redirectAfterLogin();
      }
    } catch (error) {
      // Handle reCAPTCHA error
      if (error.message === "recaptcha-failed") {
        recaptchaError.textContent =
          "Human verification failed. Please try again.";
        recaptchaError.classList.remove("hidden");
      }
      // Handle specific Firebase auth errors
      else if (error.code === "auth/email-already-in-use") {
        emailError.textContent = "Email is already in use.";
        emailError.classList.remove("hidden");
      } else if (error.code === "auth/invalid-email") {
        emailError.textContent = "Invalid email format.";
        emailError.classList.remove("hidden");
      } else if (error.code === "auth/weak-password") {
        passwordError.textContent = "Password is too weak.";
        passwordError.classList.remove("hidden");
      } else {
        console.error("Registration error:", error);
        emailError.textContent =
          "An error occurred during registration. Please try again.";
        emailError.classList.remove("hidden");
      }
    } finally {
      // Reset UI state
      submitBtn.disabled = false;
      loadingSpinner.classList.add("hidden");
    }
  });

  // Function to execute reCAPTCHA
  const executeRecaptcha = (action) => {
    return new Promise((resolve, reject) => {
      if (!window.grecaptcha) {
        reject(new Error("reCAPTCHA not loaded"));
        return;
      }

      try {
        window.grecaptcha.ready(() => {
          window.grecaptcha
            .execute(RECAPTCHA_SITE_KEY, { action })
            .then((token) => {
              document.getElementById("recaptchaToken").value = token;
              resolve(token);
            })
            .catch((err) => {
              console.error("reCAPTCHA execution error:", err);
              reject(err);
            });
        });
      } catch (error) {
        console.error("reCAPTCHA error:", error);
        reject(error);
      }
    });
  };

  // Function to verify the token with your backend
  const verifyRecaptchaToken = async (token) => {
    try {
      // Update this URL to match your FastAPI endpoint
      const response = await fetch("/verify-recaptcha", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("reCAPTCHA verification failed:", errorData);
        return false;
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error("Error verifying reCAPTCHA:", error);
      return false;
    }
  };
});
