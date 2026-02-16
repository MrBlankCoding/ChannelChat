import { ref, onValue, set, onDisconnect, serverTimestamp } from "firebase/database";
import { db } from "./firebase";
import type { User } from "firebase/auth";

export const initPresence = (user: User) => {
    const isOfflineForDatabase = {
        state: 'offline',
        last_changed: serverTimestamp(),
    };

    const isOnlineForDatabase = {
        state: 'online',
        last_changed: serverTimestamp(),
    };

    const userStatusDatabaseRef = ref(db, '/status/' + user.uid);

    const connectedRef = ref(db, '.info/connected');
    
    onValue(connectedRef, (snapshot) => {
        if (snapshot.val() === false) {
            return;
        }

        onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
            set(userStatusDatabaseRef, isOnlineForDatabase);
        });
    });
};
