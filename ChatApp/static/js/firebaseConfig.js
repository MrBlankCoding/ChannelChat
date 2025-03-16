export const getFirebaseConfig = async () => {
  try {
    const serverBaseUrl = new URL(window.location.origin);
    serverBaseUrl.pathname = "/firebase-config";

    const response = await axios.get(serverBaseUrl.toString());
    return response.data;
  } catch (error) {
    console.error("Error fetching Firebase config:", error);
    throw error;
  }
};

export const initFirebase = async () => {
  try {
    const firebaseConfig = await getFirebaseConfig();

    const { initializeApp } = await import(
      "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js"
    );
    const {
      getStorage,
      ref,
      uploadBytes,
      getDownloadURL,
      uploadBytesResumable,
    } = await import(
      "https://www.gstatic.com/firebasejs/11.2.0/firebase-storage.js"
    );
    const { getAnalytics } = await import(
      "https://www.gstatic.com/firebasejs/11.2.0/firebase-analytics.js"
    );
    const { getMessaging, getToken, onMessage, deleteToken } = await import(
      "https://www.gstatic.com/firebasejs/11.2.0/firebase-messaging.js"
    );

    const {
      getAuth,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      onAuthStateChanged,
      updateProfile,
      sendPasswordResetEmail,
      sendEmailVerification,
      setPersistence,
      browserSessionPersistence,
      browserLocalPersistence,
    } = await import(
      "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js"
    );

    // Initialize the Firebase app
    const app = initializeApp(firebaseConfig);

    // Initialize services
    const auth = getAuth(app);
    const storage = getStorage(app);
    const analytics = getAnalytics(app);
    const messaging = getMessaging(app);

    console.log("Firebase initialized. Messaging instance:", messaging);

    return {
      app,
      auth,
      storage,
      analytics,
      messaging,
      storageUtils: { ref, uploadBytes, getDownloadURL, uploadBytesResumable },
      authUtils: {
        createUserWithEmailAndPassword,
        signInWithEmailAndPassword,
        signOut,
        onAuthStateChanged,
        updateProfile,
        sendPasswordResetEmail,
        sendEmailVerification,
        setPersistence, // Add these three
        browserSessionPersistence, // persistence-related
        browserLocalPersistence, // properties
      },
      messagingUtils: { getToken, onMessage, deleteToken },
    };
  } catch (error) {
    console.error("Error initializing Firebase:", error);
    throw error;
  }
};
