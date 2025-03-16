import base64
import os
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Dict

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


class KeyManagement:
    def __init__(self, master_key: bytes = None):
        """Initialize with a master key or load from persistent storage."""
        if master_key:
            self.master_key = master_key
        else:
            try:
                # Load master encription key
                self.master_key = base64.b64decode(os.getenv("MASTER_KEY"))
            except (KeyError, ValueError):
                # Create one if it doesnt exsist
                self.master_key = os.urandom(32)
                os.environ["MASTER_KEY"] = base64.b64encode(self.master_key).decode(
                    "utf-8"
                )

        self._room_keys: Dict[str, tuple[bytes, datetime]] = {}
        self.key_rotation_interval = timedelta(days=7)

    def _derive_room_key(self, room_id: str) -> bytes:
        """Derive a room-specific key using the master key."""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=room_id.encode(),
            iterations=100000,
        )
        # use bytes for better memory management
        return kdf.derive(self.master_key)

    def get_room_key(self, room_id: str) -> bytes:
        """Get or generate a room key with automatic rotation."""
        current_time = datetime.utcnow()
        if room_id in self._room_keys:
            key, creation_time = self._room_keys[room_id]
            if current_time - creation_time < self.key_rotation_interval:
                return key

        new_key = self._derive_room_key(room_id)
        self._room_keys[room_id] = (new_key, current_time)
        return new_key


class MessageEncryption:
    def __init__(self):
        """Initialize encryption with key management."""
        self.key_manager = KeyManagement()
        self._cache = {}

    @lru_cache(maxsize=1000)
    def _get_encryption_suite(self, room_id: str) -> AESGCM:
        """Get or create an AESGCM instance for a room with caching."""
        key = self.key_manager.get_room_key(room_id)
        return AESGCM(key)

    def encrypt_message(self, content: str, room_id: str) -> tuple[str, str]:
        """Encrypt a message string with associated room data."""
        nonce = os.urandom(12)  # 96 bits for GCM
        aesgcm = self._get_encryption_suite(room_id)

        encrypted_data = aesgcm.encrypt(nonce, content.encode(), room_id.encode())

        # Return base64 encoded strings
        return (
            base64.b64encode(encrypted_data).decode("utf-8"),
            base64.b64encode(nonce).decode("utf-8"),
        )

    def decrypt_message(self, encrypted_content: str, nonce: str, room_id: str) -> str:
        """Decrypt an encrypted message string."""
        try:
            aesgcm = self._get_encryption_suite(room_id)

            # Decode base64 strings
            encrypted_data = base64.b64decode(encrypted_content.encode("utf-8"))
            nonce_bytes = base64.b64decode(nonce.encode("utf-8"))

            decrypted_data = aesgcm.decrypt(
                nonce_bytes, encrypted_data, room_id.encode()
            )

            return decrypted_data.decode("utf-8")
        except (ValueError, TypeError) as e:
            print(f"Decryption error: {e}")
            raise
