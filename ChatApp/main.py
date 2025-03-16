# Standard library imports
import os
import json
import random
import re
import time
import string
import functools
import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, Dict, Optional, List, Set, AsyncGenerator, Tuple
import base64
import uuid
from collections import defaultdict

# Third-party imports
import aiohttp
import httpx
from bson.errors import InvalidId
from cachetools import TTLCache
import zstandard as zstd
from bson import ObjectId
from base64 import b64encode, b64decode
import firebase_admin
from firebase_admin import credentials, storage, auth as firebase_auth, messaging
import google.auth.transport.requests
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from fastapi import (
    FastAPI,
    Query,
    Request,
    HTTPException,
    Depends,
    status,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi import File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne
from pymongo.write_concern import WriteConcern
from pymongo.read_preferences import ReadPreference
import pymongo
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, ConfigDict
import sentry_sdk
import logging

# Configure logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# Load Vars
load_dotenv()


# Config
class Settings:
    SECRET_KEY: str = os.getenv("SECRET_KEY", "default-secret-key")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    )
    MONGODB_URL: str = os.getenv("MONGODB_URL", "")
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "chat_db")

    # Firebase cred
    cred = credentials.Certificate("serviceAccountKey.json")
    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(
            cred, {"storageBucket": "channelchat-7d679.appspot.com"}
        )


settings = Settings()


# Pydantic Models
class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class User(UserBase):
    is_active: bool = True
    profile_photo_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)
    firebase_uid: str


class FriendRequest(BaseModel):
    from_user_id: str
    to_user_id: str
    status: str = "pending"  # pending, accepted, declined
    created_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str

class RecaptchaRequest(BaseModel):
    token: str

class RecaptchaResponse(BaseModel):
    success: bool
    score: Optional[float] = None
    message: Optional[str] = None


class FCMTokenCreate(BaseModel):
    token: str
    device_id: str
    device_type: str  # "android", "ios", "web"


class FCMToken(FCMTokenCreate):
    user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class PushNotification(BaseModel):
    title: str
    body: str
    data: Optional[dict] = None
    image_url: Optional[str] = None
    topic: Optional[str] = None
    token: Optional[str] = None
    user_ids: Optional[List[str]] = None


class TokenData(BaseModel):
    email: Optional[str] = None


class MessageRead(BaseModel):
    message_id: str
    read_by: List[str] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    content: str
    room_id: Optional[str] = None
    encrypted: bool = True
    reply_to: Optional[dict] = None
    message_type: str = "text"  # Add message type field


# Add to your MessageResponse model:
class MessageResponse(BaseModel):
    id: str
    content: str
    username: str
    timestamp: datetime
    room_id: str
    room_name: Optional[str] = None
    compressed: bool = False
    encrypted: bool = True
    nonce: Optional[str] = None
    reply_to: Optional[dict] = None
    reactions: Optional[Dict[str, List[str]]] = None
    edited: bool = False
    edited_at: Optional[datetime] = None
    read_by: List[str] = Field(default_factory=list)
    message_type: str = "text"  # Add message type field
    model_config = ConfigDict(from_attributes=True)


class UserPresence(BaseModel):
    user_id: str
    room_id: str
    status: str  # "active" or "inactive"
    last_active: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class RoomResponse(BaseModel):
    id: str
    name: str
    code: str
    created_by: str
    created_at: datetime
    members: List[str] = []  # List of user IDs
    is_owner: bool = False
    unread_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class RoomJoin(BaseModel):
    code: str


class RoomMember(BaseModel):
    user_id: str
    username: str
    email: str
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class RoomInvite(BaseModel):
    room_id: str
    user_id: str
    invited_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "pending"  # pending, accepted, declined
    model_config = ConfigDict(from_attributes=True)


class RoomInviteCreate(BaseModel):
    room_id: str
    userId: str  # Matching the frontend field name


class RoomInviteResponse(BaseModel):
    id: str
    room_id: str
    room_name: str
    invited_by: str
    invitedBy: str  # Added for frontend compatibility
    userId: str
    username: str
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class InviteActionResponse(BaseModel):
    success: bool
    roomId: str
    message: str


# CONNECTION POOL
class ConnectionPool:
    def __init__(
        self,
        uri: str,
        min_pool_size: int = 1,
        max_pool_size: int = 10,
        max_idle_time_ms: int = 300000,
        retry_writes: bool = True,
    ):
        self.uri = uri
        self.min_pool_size = min_pool_size
        self.max_pool_size = max_pool_size
        self.max_idle_time_ms = max_idle_time_ms
        self.retry_writes = retry_writes
        self._pools: Dict[str, AsyncIOMotorClient] = {}
        self._last_used: Dict[str, datetime] = {}
        self._lock = asyncio.Lock()

    async def get_client(self, database_name: str) -> AsyncIOMotorClient:
        """Get a client from the pool or create a new one if needed."""
        async with self._lock:
            client = self._pools.get(database_name)

            if client:
                try:
                    # check if client is valid
                    await asyncio.wait_for(client.admin.command("ping"), timeout=2.0)
                    self._last_used[database_name] = datetime.utcnow()
                    return client
                except (pymongo.errors.PyMongoError, asyncio.TimeoutError):
                    # Remove from pool before closing
                    if database_name in self._pools:
                        old_client = self._pools.pop(database_name, None)
                        self._last_used.pop(database_name, None)

                        if old_client:
                            try:
                                await old_client.close()
                            except pymongo.errors.PyMongoError:
                                pass

            # Just create one
            client = await self._create_client(database_name)
            if not client:
                raise ConnectionError(
                    f"Failed to create MongoDB client for database {database_name}"
                )
            return client

    async def _create_client(self, database_name: str) -> Optional[AsyncIOMotorClient]:
        """Create and test a new MongoDB client."""
        try:
            client = AsyncIOMotorClient(
                self.uri,
                minPoolSize=self.min_pool_size,
                maxPoolSize=self.max_pool_size,
                maxIdleTimeMS=self.max_idle_time_ms,
                retryWrites=self.retry_writes,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=10000,
                socketTimeoutMS=45000,
                waitQueueTimeoutMS=10000,
                heartbeatFrequencyMS=10000,
                retryReads=True,
            )

            # Try to connect
            await asyncio.wait_for(client.admin.command("ping"), timeout=5.0)
            self._pools[database_name] = client
            self._last_used[database_name] = datetime.utcnow()
            return client

        except pymongo.errors.PyMongoError as e:
            if "client" in locals():
                try:
                    await client.close()
                except (pymongo.errors.PyMongoError, asyncio.TimeoutError):
                    pass
            raise ConnectionError(f"Failed to connect to MongoDB: {e}") from e

    async def close_all(self):
        """Close all database connections in the pool."""
        for client in self._pools.values():
            try:
                await client.close()
            except (pymongo.errors.PyMongoError, asyncio.TimeoutError):
                pass
        self._pools.clear()
        self._last_used.clear()


class Database:
    def __init__(self):
        """Initialize database with connection pool."""
        self.connection_pool: Optional[ConnectionPool] = None
        self._database_name: Optional[str] = None
        self._lock = asyncio.Lock()

    async def connect(self, database_name: str = settings.DATABASE_NAME):
        """Connect to MongoDB using connection pool."""
        async with self._lock:
            if not self.connection_pool:
                self.connection_pool = ConnectionPool(
                    uri=settings.MONGODB_URL,
                    min_pool_size=10,
                    max_pool_size=50,
                    max_idle_time_ms=300000,  # 5 minutes
                )
            self._database_name = database_name
            await self.connection_pool.get_client(database_name)
            await self.create_indexes()

    @property
    async def db(self):
        """Get current database instance with automatic reconnection."""
        if not self._database_name:
            raise RuntimeError("Database not initialized. Call connect() first.")

        client = await self.connection_pool.get_client(self._database_name)
        return client[self._database_name]

    @asynccontextmanager
    async def get_client(self) -> AsyncGenerator[AsyncIOMotorClient, None]:
        """Context manager for getting a database client with automatic reconnection."""
        if not self._database_name:
            raise RuntimeError("Database not initialized. Call connect() first.")

        try:
            client = await self.connection_pool.get_client(self._database_name)
            yield client
        except pymongo.errors.PyMongoError as e:
            print(f"Error in database connection: {e}")
            raise

    async def create_indexes(self):
        """Create necessary database indexes."""
        async with self.get_client() as client:
            db = client[self._database_name]

            # Create indexes in parallel
            index_tasks = [
                db.users.create_index([("email", 1)], unique=True),
                db.users.create_index([("username", 1)], unique=True),
                db.messages.create_index([("timestamp", -1)]),
                db.messages.create_index([("room_id", 1)]),
                db.rooms.create_index([("code", 1)], unique=True),
                db.rooms.create_index([("created_by", 1)]),
                db.room_memberships.create_index(
                    [("user_id", 1), ("room_id", 1)], unique=True
                ),
                db.room_memberships.create_index([("joined_at", -1)]),
            ]

            await asyncio.gather(*index_tasks)

    async def close(self):
        """Close all database connections."""
        if self.connection_pool:
            await self.connection_pool.close_all()


class ConnectionManager:
    def __init__(self):
        # Modified to handle connections without room assignment
        self.active_connections: Dict[str, Dict[str, Set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )
        self.user_presence: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        self.connection_count: Dict[str, Dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        # Track user's current room
        self.user_rooms: Dict[str, Optional[str]] = {}
        self.presence_cache = {}
        self.presence_cache_ttl = 2

    async def connect(
        self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None
    ):
        """Connect a websocket with optional room assignment"""
        # Remove this line since connection is already accepted
        # await websocket.accept()

        if room_id:
            self.active_connections[room_id][user_id].add(websocket)
            self.connection_count[room_id][user_id] += 1

            # Initialize presence with proper structure
            self.user_presence[room_id][user_id] = {
                "status": "active",
                "last_active": datetime.utcnow().isoformat(),
            }

            # Clear cache on connection changes
            self._invalidate_presence_cache(room_id)
            await self.broadcast_presence(room_id)
        else:
            # Store connection in a special "unassigned" section
            self.active_connections["unassigned"][user_id].add(websocket)
            self.connection_count["unassigned"][user_id] += 1

        # Track user's current room
        self.user_rooms[user_id] = room_id

    async def switch_room(self, websocket: WebSocket, user_id: str, new_room_id: str):
        """Switch a websocket connection to a new room"""
        try:
            old_room_id = self.user_rooms.get(user_id, "unassigned")

            # Remove from old room or unassigned
            if old_room_id:
                if websocket in self.active_connections[old_room_id][user_id]:
                    self.active_connections[old_room_id][user_id].remove(websocket)
                    self.connection_count[old_room_id][user_id] -= 1

                    if self.connection_count[old_room_id][user_id] <= 0:
                        self.active_connections[old_room_id].pop(user_id, None)
                        self.connection_count[old_room_id].pop(user_id, None)
                        self.user_presence[old_room_id].pop(user_id, None)

                    # Clean up empty old room
                    if not self.active_connections[old_room_id]:
                        self.active_connections.pop(old_room_id, None)
                        self.connection_count.pop(old_room_id, None)
                        self.user_presence.pop(old_room_id, None)
                        self._invalidate_presence_cache(old_room_id)
                    else:
                        await self.broadcast_presence(old_room_id)

                # Add to new room
                self.active_connections[new_room_id][user_id].add(websocket)
                self.connection_count[new_room_id][user_id] += 1

                # Initialize presence in new room
                self.user_presence[new_room_id][user_id] = {
                    "status": "active",
                    "last_active": datetime.utcnow().isoformat(),
                }

                # Update user's current room
                self.user_rooms[user_id] = new_room_id

                # Invalidate cache and broadcast presence for new room
                self._invalidate_presence_cache(new_room_id)
                await self.broadcast_presence(new_room_id)

        except Exception as e:
            print(f"Error in room switch: {str(e)}")
            raise

    async def handle_disconnect(
        self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None
    ):
        """Handle disconnection with optional room ID"""
        try:
            # Get actual room_id from user_rooms if not provided
            actual_room_id = room_id or self.user_rooms.get(user_id, "unassigned")

            if websocket in self.active_connections[actual_room_id][user_id]:
                self.active_connections[actual_room_id][user_id].remove(websocket)
                self.connection_count[actual_room_id][user_id] -= 1

                if self.connection_count[actual_room_id][user_id] <= 0:
                    self.active_connections[actual_room_id].pop(user_id, None)
                    self.connection_count[actual_room_id].pop(user_id, None)

                    # Update presence to offline before removing
                    if user_id in self.user_presence[actual_room_id]:
                        self.user_presence[actual_room_id][user_id][
                            "status"
                        ] = "offline"
                        self._invalidate_presence_cache(actual_room_id)
                        await self.broadcast_presence(actual_room_id)
                        # Then remove from presence tracking
                        self.user_presence[actual_room_id].pop(user_id, None)

                    # Clean up empty rooms
                    if not self.active_connections[actual_room_id]:
                        self.active_connections.pop(actual_room_id, None)
                        self.connection_count.pop(actual_room_id, None)
                        self.user_presence.pop(actual_room_id, None)
                        self._invalidate_presence_cache(actual_room_id)
                    else:
                        await self.broadcast_presence(actual_room_id)

                # Clean up user room tracking
                if user_id in self.user_rooms:
                    del self.user_rooms[user_id]

        except Exception as e:
            print(f"Error in disconnect handling: {str(e)}")

    # Rest of the methods remain the same
    async def broadcast(
        self,
        message: dict,
        room_id: str,
        exclude_user_id: Optional[str] = None,
    ):
        message_json = json.dumps(message)
        conn_tasks = []

        if room_id in self.active_connections:
            for user_id, connections in self.active_connections[room_id].items():
                if user_id != exclude_user_id and connections:
                    conn_tasks.extend(
                        [conn.send_text(message_json) for conn in connections]
                    )

            if conn_tasks:
                await asyncio.gather(*conn_tasks, return_exceptions=True)

    def _invalidate_presence_cache(self, room_id: str):
        if room_id in self.presence_cache:
            self.presence_cache.pop(room_id, None)

    async def update_presence(
        self, user_id: str, room_id: str, status: str, last_active: datetime = None
    ):

        timestamp = (
            last_active.isoformat() if last_active else datetime.utcnow().isoformat()
        )

        if room_id not in self.user_presence:
            self.user_presence[room_id] = {}

        self.user_presence[room_id][user_id] = {
            "status": status,
            "last_active": timestamp,
        }

        self._invalidate_presence_cache(room_id)
        await self.broadcast_presence(room_id)

    async def broadcast_presence(self, room_id: str):
        current_time = time.time()
        cache_entry = self.presence_cache.get(room_id)
        if (
            cache_entry
            and current_time - cache_entry["timestamp"] < self.presence_cache_ttl
        ):
            presence_message = cache_entry["message"]
        else:
            presence_message = {
                "type": "presence",
                "presence": self.user_presence.get(room_id, {}),
            }
            self.presence_cache[room_id] = {
                "message": presence_message,
                "timestamp": current_time,
            }

        await self.broadcast(presence_message, room_id)

    def get_active_users(self, room_id: str) -> List[str]:
        return [
            user_id
            for user_id, presence_data in self.user_presence[room_id].items()
            if isinstance(presence_data, dict)
            and presence_data.get("status") == "active"
        ]


class MessageCompression:
    def __init__(self, compression_level: int = 3):
        """Initialize with configurable compression level (1-22)"""
        self.compression_level = compression_level
        self.compressor = zstd.ZstdCompressor(level=compression_level)
        self.decompressor = zstd.ZstdDecompressor()

    def compress_message(self, content: str) -> Tuple[str, bool]:
        """
        Compress message content if beneficial.
        Returns (compressed_content, is_compressed)
        """
        if not content or len(content) < 100:  # Don't compress small messages
            return content, False

        try:
            compressed = self.compressor.compress(content.encode("utf-8"))
            compressed_b64 = b64encode(compressed).decode("utf-8")

            # Only use compression if it actually saves space
            if len(compressed_b64) < len(content):
                return compressed_b64, True
            return content, False
        except Exception as e:
            print(f"Compression error: {e}")
            return content, False

    def decompress_message(self, content: str, is_compressed: bool) -> str:
        """Decompress message content if it was compressed"""
        if not is_compressed or not content:
            return content

        try:
            # Always treat as base64 encoded data
            compressed_data = b64decode(content.encode("utf-8"))
            decompressed = self.decompressor.decompress(compressed_data)
            return decompressed.decode("utf-8")
        except Exception as e:
            print(f"Decompression error: {str(e)}")
            return "[Decompression failed]"

    async def process_message_batch(
        self, messages: list, room_id: str, message_encryption
    ) -> None:
        """Process a batch of messages - handling both decompression and decryption"""
        for msg in messages:
            if msg.get("message_type") == "image":
                continue

            try:
                # First decrypt if message is encrypted
                if msg.get("encrypted") and msg.get("content") and msg.get("nonce"):
                    msg["content"] = await asyncio.to_thread(
                        message_encryption.decrypt_message,
                        msg["content"],
                        msg["nonce"],
                        room_id,
                    )

                # Then decompress if message was compressed
                if msg.get("compressed"):
                    msg["content"] = self.decompress_message(msg["content"], True)

            except Exception as e:
                print(f"Error processing message {msg.get('_id')}: {e}")
                msg["content"] = "[Processing failed]"


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

class FirebaseNotificationService:
    def __init__(self):
        self.app = firebase_admin.get_app()
        # Get the project ID from your Firebase app
        self.project_id = self.app.project_id
        # Initialize with your service account credentials
        self.auth_token = None
        self.auth_token_expiry = 0

    async def _get_auth_token(self):
        """Get a valid OAuth token for FCM API requests."""
        now = int(time.time())

        # Return the existing valid token if it's not expired
        if self.auth_token and now < self.auth_token_expiry - 60:
            return self.auth_token

        try:
            # Check if app.credential has the get_access_token method
            if hasattr(self.app.credential, 'get_access_token'):
                access_token_info = await asyncio.to_thread(
                    self.app.credential.get_access_token
                )
                self.auth_token = access_token_info.access_token

                # Handle different expiry attribute names
                if hasattr(access_token_info, 'expiry'):
                    self.auth_token_expiry = int(access_token_info.expiry.timestamp())
                elif hasattr(access_token_info, 'expires_in'):
                    self.auth_token_expiry = now + access_token_info.expires_in
                else:
                    self.auth_token_expiry = now + 3600  # Default 1-hour expiry

            # Handle Firebase Admin SDK credential token refresh
            elif hasattr(self.app.credential, 'refresh'):
                request = google.auth.transport.requests.Request()
                credentials = self.app.credential
                await asyncio.to_thread(credentials.refresh, request)
                self.auth_token = credentials.token
                self.auth_token_expiry = int(credentials.expiry.timestamp())

            else:
                # Fallback to using Firebase messaging's internal authentication
                self.auth_token = "using_internal_auth"
                self.auth_token_expiry = now + 3600  # Assume 1-hour expiry

            return self.auth_token

        except Exception as e:
            print(f"Error getting auth token: {e}")
            raise

    
    async def send_to_token(
        self,
        token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
        image_url: Optional[str] = None,
    ):
        """Send notification to a specific device token."""
        try:
            # For single token, we can still use the Admin SDK directly
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title, body=body, image=image_url
                ),
                data=data or {},
                token=token,
            )
            return await asyncio.to_thread(messaging.send, message, app=self.app)
        except Exception as e:
            print(f"Error sending to token {token}: {str(e)}")
            return None

    async def send_to_tokens(
        self,
        tokens: List[str],
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
        image_url: Optional[str] = None,
    ):
        """Send notification to multiple device tokens using v1 HTTP endpoint."""
        if not tokens:
            return []

        # Chunk tokens into batches of 500 (FCM limit)
        batch_size = 500
        token_chunks = [
            tokens[i : i + batch_size] for i in range(0, len(tokens), batch_size)
        ]

        results = []
        auth_token = await self._get_auth_token()
        
        for chunk in token_chunks:
            try:
                # For v11.2 compatibility, use the HTTP v1 API directly
                url = f"https://fcm.googleapis.com/v1/projects/{self.project_id}/messages:send"
                
                headers = {
                    "Authorization": f"Bearer {auth_token}",
                    "Content-Type": "application/json"
                }
                
                # We'll make individual requests for each token
                # This is less efficient but more compatible
                batch_success = 0
                batch_failure = 0
                
                async with aiohttp.ClientSession() as session:
                    for token in chunk:
                        payload = {
                            "message": {
                                "token": token,
                                "notification": {
                                    "title": title,
                                    "body": body
                                }
                            }
                        }
                        
                        # Add image if provided
                        if image_url:
                            payload["message"]["notification"]["image"] = image_url
                            
                        # Add data if provided
                        if data:
                            payload["message"]["data"] = data
                            
                        try:
                            async with session.post(url, headers=headers, json=payload) as resp:
                                if resp.status == 200:
                                    batch_success += 1
                                else:
                                    batch_failure += 1
                                    resp_text = await resp.text()
                                    print(f"FCM error for token {token}: {resp.status} - {resp_text}")
                        except Exception as token_error:
                            batch_failure += 1
                            print(f"Error sending to token {token}: {str(token_error)}")
                
                results.append({
                    "success_count": batch_success,
                    "failure_count": batch_failure
                })
                        
            except Exception as e:
                print(f"Error sending to token batch: {str(e)}")
                results.append(
                    {"success_count": 0, "failure_count": len(chunk), "error": str(e)}
                )

        return results

    async def send_to_topic(
        self,
        topic: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
        image_url: Optional[str] = None,
    ):
        """Send notification to all devices subscribed to a topic."""
        try:
            # Ensure topic name is correctly formatted
            if not topic.startswith('/topics/'):
                topic = f'/topics/{topic}'
                
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title, body=body, image=image_url
                ),
                data=data or {},
                topic=topic,
            )
            return await asyncio.to_thread(messaging.send, message, app=self.app)
        except Exception as e:
            print(f"Error sending to topic {topic}: {str(e)}")
            return None

    async def subscribe_to_topic(self, tokens: List[str], topic: str):
        """Subscribe devices to a topic."""
        try:
            response = await asyncio.to_thread(
                messaging.subscribe_to_topic, tokens, topic, app=self.app
            )
            return {
                "success_count": response.success_count,
                "failure_count": response.failure_count,
            }
        except Exception as e:
            print(f"Error subscribing to topic {topic}: {str(e)}")
            return {"success_count": 0, "failure_count": len(tokens), "error": str(e)}

    async def unsubscribe_from_topic(self, tokens: List[str], topic: str):
        """Unsubscribe devices from a topic."""
        try:
            response = await asyncio.to_thread(
                messaging.unsubscribe_from_topic, tokens, topic, app=self.app
            )
            return {
                "success_count": response.success_count,
                "failure_count": response.failure_count,
            }
        except Exception as e:
            print(f"Error unsubscribing from topic {topic}: {str(e)}")
            return {"success_count": 0, "failure_count": len(tokens), "error": str(e)}


# Compression and encryption
message_encryption = MessageEncryption()
message_compression = MessageCompression()

# Initialize database and connection manager
db = Database()
manager = ConnectionManager()

# message cache -> before redis
message_cache = TTLCache(maxsize=1000, ttl=60)

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
MIN_SCORE = 0.5

#Sentry
sentry_sdk.init(
    dsn="https://2cff94f801516559b6dc08cbef176e0d@o4508916224294912.ingest.us.sentry.io/4508916226129920",
    # Add data like request headers and IP for users,
    # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
    send_default_pii=True,
    # Set traces_sample_rate to 1.0 to capture 100%
    # of transactions for tracing.
    traces_sample_rate=1.0,
    _experiments={
        # Set continuous_profiling_auto_start to True
        # to automatically start the profiler on when
        # possible.
        "continuous_profiling_auto_start": True,
    },
)

# App initialization
app = FastAPI(title="Channel Chat", version="0.1.0")

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@asynccontextmanager
async def lifespan_context(app: FastAPI):
    """Manage app startup and shutdown with connection pooling."""
    global db, fcm_service
    db = Database()
    fcm_service = FirebaseNotificationService()

    try:
        # Startup logic with retries
        max_retries = 3
        retry_delay = 5  # seconds

        for attempt in range(max_retries):
            try:
                # Attempt database connection
                await db.connect()
                # Test the connection by performing a simple operation
                async with db.get_client() as client:
                    await client.admin.command("ping")

                print(
                    f"✓ Successfully connected to database (attempt {attempt + 1}/{max_retries})"
                )
                break

            except asyncio.TimeoutError as attempt_exception:
                if attempt == max_retries - 1:
                    raise RuntimeError(
                        "Database connection timeout after all retry attempts"
                    ) from attempt_exception
                print(
                    f"× Connection attempt {attempt + 1}/{max_retries} timed out, retrying in {retry_delay} seconds..."
                )
                await asyncio.sleep(retry_delay)

            except (pymongo.errors.PyMongoError, asyncio.TimeoutError) as e:
                if attempt == max_retries - 1:
                    raise RuntimeError(
                        f"Failed to connect to database after {max_retries} attempts: {str(e)}"
                    ) from e
                print(
                    f"× Connection attempt {attempt + 1}/{max_retries} failed: {str(e)}, retrying in {retry_delay} seconds..."
                )
                await asyncio.sleep(retry_delay)

        # Create indexes for FCM tokens
        async with db.get_client() as client:
            database = client[db._database_name]
            await database.fcm_tokens.create_index([("token", 1)], unique=True)
            await database.fcm_tokens.create_index([("user_id", 1)])
            await database.fcm_tokens.create_index([("device_id", 1)])

        yield  # Hand over control to the app

    except Exception as e:
        print(f"! Critical error during startup: {str(e)}")
        raise  # Re-raise the exception to prevent app startup

    finally:
        # Shutdown logic
        try:
            await db.close()
            print("✓ Database connections closed successfully")
        except asyncio.TimeoutError:
            print("! Warning: Database shutdown timed out")
        except Exception as e:
            print(f"! Warning: Error during database shutdown: {str(e)}")


app = FastAPI(lifespan=lifespan_context)

# Static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


async def get_current_user(request: Request):
    """Verify Firebase ID token and get current user."""

    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split("Bearer ")[1].strip()

    try:
        # Verify the Firebase ID token
        decoded_token = firebase_auth.verify_id_token(token)
        uid = decoded_token["uid"]

        # Get the user from your database using Firebase UID
        database = await db.db
        user = await database.users.find_one({"firebase_uid": uid})

        if not user:
            # Auto-create the user in database if they exist in Firebase but not in database
            # This can happen if Firebase Auth is set up but user hasn't been added to your DB
            firebase_user = firebase_auth.get_user(uid)
            new_user = {
                "firebase_uid": uid,
                "email": firebase_user.email,
                "username": firebase_user.display_name
                or firebase_user.email.split("@")[0],
                "is_active": True,
                "created_at": datetime.utcnow(),
                "profile_photo_url": firebase_user.photo_url,
            }
            await database.users.insert_one(new_user)
            return new_user

        return user
    except firebase_auth.InvalidIdTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Failed to authenticate: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.get("/firebase-config")
async def get_firebase_config():
    """Return Firebase configuration for client-side initialization."""
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"),
    }

@app.post("/verify-recaptcha", response_model=RecaptchaResponse)
async def verify_recaptcha(request: RecaptchaRequest):
    if not request.token:
        raise HTTPException(status_code=400, detail="reCAPTCHA token is required")
    
    try:
        # Verify the token with Google
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://www.google.com/recaptcha/api/siteverify",
                params={
                    "secret": RECAPTCHA_SECRET_KEY,
                    "response": request.token
                }
            )
            
            verification_data = response.json()
            
            # Check if verification was successful and if the score is high enough
            if (verification_data.get("success", False) and 
                verification_data.get("score", 0) >= MIN_SCORE and 
                verification_data.get("action") == "register"):
                
                return RecaptchaResponse(
                    success=True,
                    score=verification_data.get("score")
                )
            else:
                print(f"reCAPTCHA verification failed: {verification_data}")
                return RecaptchaResponse(
                    success=False,
                    message="reCAPTCHA verification failed"
                )
    
    except Exception as e:
        print(f"Error verifying reCAPTCHA: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail="Error verifying reCAPTCHA"
        )


@app.post("/users")
async def create_user_in_database(user_data: dict):
    """Create a user in the database after they've registered with Firebase Auth.

    This endpoint assumes the client has already created the user in Firebase Auth.
    The client should send the Firebase user data including the UID.
    """
    database = await db.db

    # Check if user with this Firebase UID already exists
    if await database.users.find_one({"firebase_uid": user_data["firebase_uid"]}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="User already exists"
        )

    # Create a new user document
    new_user = {
        "firebase_uid": user_data["firebase_uid"],
        "email": user_data["email"],
        "username": user_data.get("username", user_data["email"].split("@")[0]),
        "is_active": True,
        "created_at": datetime.utcnow(),
        "profile_photo_url": user_data.get("profile_photo_url", None),
    }

    result = await database.users.insert_one(new_user)

    return {"id": str(result.inserted_id), "message": "User created successfully"}


@app.get("/users/me", response_model=User)
async def read_users_me(current_user: dict = Depends(get_current_user)):
    """Get current user info."""
    return User(
        email=current_user["email"],
        username=current_user["username"],
        is_active=current_user.get("is_active", True),
        profile_photo_url=current_user.get("profile_photo_url"),
        firebase_uid=current_user["firebase_uid"],
    )


@app.get("/users/{username}/profile-photo")
async def get_user_profile_photo(username: str):
    """Retrieve a user's profile photo URL by username."""

    database = await db.db

    # Find the user by username
    user = await database.users.find_one({"username": username})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Return profile photo URL, or None if not set
    return {"profile_photo_url": user.get("profile_photo_url")}


@app.post("/users/profile-photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload profile photo to Firebase Storage."""
    database = await db.db

    # Validate file type and size
    allowed_types = ["image/jpeg", "image/png", "image/gif"]
    max_file_size = 5 * 1024 * 1024  # 5 MB

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and GIF are allowed.",
        )

    # Read file contents
    file_contents = await file.read()

    if len(file_contents) > max_file_size:
        raise HTTPException(status_code=400, detail="File size exceeds 5 MB limit.")

    # Generate unique filename using Firebase UID instead of MongoDB _id
    file_extension = file.filename.split(".")[-1]
    unique_filename = (
        f"profile_photos/{current_user['firebase_uid']}_{uuid.uuid4()}.{file_extension}"
    )

    # Upload to Firebase Storage
    bucket = storage.bucket()
    blob = bucket.blob(unique_filename)

    # Make the blob publicly readable
    blob.upload_from_string(file_contents, content_type=file.content_type)
    blob.make_public()

    # Get public URL
    profile_photo_url = blob.public_url

    # Update user document with profile photo URL
    result = await database.users.update_one(
        {"firebase_uid": current_user["firebase_uid"]},
        {"$set": {"profile_photo_url": profile_photo_url}},
    )

    if result.modified_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Failed to update profile photo",
        )

    return {
        "message": "Profile photo uploaded successfully",
        "profile_photo_url": profile_photo_url,
    }


@app.put("/users/settings")
async def update_user_settings(
    settings: dict, current_user: dict = Depends(get_current_user)
):
    """Update user settings - username only (password is handled by Firebase)."""
    database = await db.db
    update_data = {}
    old_username = current_user["username"]

    # Check and update username
    if settings.get("username"):
        username = settings["username"]
        existing_user = await database.users.find_one({"username": username})
        if (
            existing_user
            and existing_user["firebase_uid"] != current_user["firebase_uid"]
        ):
            raise HTTPException(status_code=400, detail="Username already taken")
        update_data["username"] = username

    # Note: Password updates should be handled on the client side using Firebase Authentication
    if settings.get("password"):
        raise HTTPException(
            status_code=400,
            detail="Password updates should be handled through Firebase Authentication",
        )

    if not update_data:
        raise HTTPException(status_code=400, detail="No updates provided")

    # Perform update to user document
    result = await database.users.update_one(
        {"firebase_uid": current_user["firebase_uid"]}, {"$set": update_data}
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Failed to update user settings")

    # If username changed, update related documents
    if "username" in update_data and update_data["username"] != old_username:
        # Update messages
        await database.messages.update_many(
            {"firebase_uid": current_user["firebase_uid"]},
            {"$set": {"username": update_data["username"]}},
        )

        # Update room memberships
        await database.room_memberships.update_many(
            {"firebase_uid": current_user["firebase_uid"]},
            {"$set": {"username": update_data["username"]}},
        )

    return {"message": "Settings updated successfully"}

# WebSocket endpoint
async def handle_presence_ping(manager, user_id: str, room_id: str):
    """Handle presence ping with connection pooling."""
    await manager.update_presence(user_id, room_id, "active")


async def handle_presence_update(manager, data: dict, user_id: str, room_id: str):
    """Handle presence update with connection pooling."""
    status = data.get("status")

    # Handle the timestamp properly - extract from last_active string if timestamp not provided
    if timestamp := data.get("timestamp"):
        last_active = datetime.fromtimestamp(timestamp / 1000)
    elif last_active_str := data.get("last_active"):
        try:
            # Parse ISO format string to datetime
            last_active = datetime.fromisoformat(last_active_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            # Fallback to current time if parsing fails
            last_active = datetime.utcnow()
    else:
        # Use current time if no timestamp data available
        last_active = datetime.utcnow()

    # Update presence directly with the ConnectionManager
    await manager.update_presence(user_id, room_id, status, last_active)


async def handle_typing_status(manager, message_data: dict, user: dict, room_id: str):
    """Handle typing status with connection pooling."""
    typing_status = {
        "type": "typing_status",
        "username": user["username"],
        "is_typing": message_data.get("is_typing", False),
    }
    await manager.broadcast(typing_status, room_id)


async def handle_emoji_reaction(
    manager, db, message_data: dict, user: dict, room_id: str
):
    """Handle emoji reactions with connection pooling."""
    message_id = message_data.get("message_id")
    emoji = message_data.get("emoji")

    async with db.get_client() as client:
        database = await db.db
        try:
            await database.messages.update_one(
                {"_id": ObjectId(message_id)},
                {"$addToSet": {f"reactions.{emoji}": user["username"]}},
            )

            await manager.broadcast(
                {
                    "type": "emoji_reaction",
                    "message_id": message_id,
                    "emoji": emoji,
                    "username": user["username"],
                },
                room_id,
            )
        except (pymongo.errors.PyMongoError, asyncio.TimeoutError) as e:
            print(f"Error adding emoji reaction: {e}")


async def handle_message_edit(
    manager,
    db,
    message_data: dict,
    user_id: str,
    room_id: str,
    message_encryption,
):
    """Handle message editing with connection pooling."""
    message_id = message_data.get("message_id")
    new_content = message_data.get("content")

    database = await db.db  # Added await
    message = await database.messages.find_one({"_id": ObjectId(message_id)})
    if not message or str(message["user_id"]) != user_id:
        return

    try:
        encrypted_content, nonce = await asyncio.to_thread(
            message_encryption.encrypt_message, new_content, room_id
        )

        update_data = {
            "content": encrypted_content,
            "nonce": nonce,
            "edited": True,
            "edited_at": datetime.utcnow(),
        }

        if reply_to := message_data.get("reply_to"):
            if reply_to.get("content"):
                encrypted_reply, reply_nonce = await asyncio.to_thread(
                    message_encryption.encrypt_message,
                    reply_to["content"],
                    room_id,
                )
                reply_to.update(
                    {
                        "content": encrypted_reply,
                        "nonce": reply_nonce,
                    }
                )

        await database.messages.update_one(
            {"_id": ObjectId(message_id)}, {"$set": update_data}
        )

        await manager.broadcast(
            {
                "type": "message_edited",
                "message_id": message_id,
                "content": new_content,
                "edited_at": datetime.utcnow().isoformat(),
            },
            room_id,
        )

    except Exception as e:
        print(f"Error editing message: {e}")


async def handle_message_delete(
    manager, db, message_data: dict, user_id: str, room_id: str
):
    """Handle message deletion with connection pooling."""
    message_id = message_data.get("message_id")

    database = await db.db  # Added await
    message = await database.messages.find_one({"_id": ObjectId(message_id)})
    if not message or str(message["user_id"]) != user_id:
        return

    await database.messages.delete_one({"_id": ObjectId(message_id)})
    await manager.broadcast(
        {"type": "message_deleted", "message_id": message_id}, room_id
    )


async def handle_read_receipt(
    manager, db, user_id: str, room_id: str, message_ids: List[str]
):
    """Handle marking messages as read with optimized performance."""
    if not message_ids:
        return  # Early return if no messages to update
        
    try:
        # Get database connection once
        database = await db.db
        
        # Use bulk operations instead of individual updates
        bulk_ops = []
        for msg_id in message_ids:
            try:
                msg_object_id = ObjectId(msg_id)
                bulk_ops.append(
                    UpdateOne(
                        {"_id": msg_object_id, "room_id": room_id},
                        {"$addToSet": {"read_by": user_id}}
                    )
                )
            except InvalidId:
                continue  # Skip invalid IDs
        
        # Execute bulk operation if we have any valid operations
        if bulk_ops:
            # Use write concern for performance
            write_concern = WriteConcern(w=1, j=False)
            coll = database.get_collection('messages', write_concern=write_concern)
            
            # Execute the bulk operation
            result = await coll.bulk_write(bulk_ops)
            
            # Only broadcast if we actually updated documents
            if result and result.modified_count > 0:
                # Broadcast read status to all users in the room
                await manager.broadcast(
                    {
                        "type": "read_receipt",
                        "message_ids": message_ids,
                        "read_by": user_id,
                        "room_id": room_id,
                    },
                    room_id,
                )
                
                # Return the number of messages updated
                return {"updated": result.modified_count}
        
        return {"updated": 0}
    except Exception as e:
        logger.error(f"Error handling read receipt: {str(e)}")
        # Return error without raising exception to avoid crashing the connection
        return {"error": "Failed to update read status"}

async def process_reply_content(reply_to, message_encryption, room_id):
    """Process reply content with connection pooling."""
    if not reply_to:
        return None

    try:
        # Get message_id from either message_id or id field
        message_id = reply_to.get("message_id") or reply_to.get("id")
        if not message_id:
            raise ValueError("Missing message ID in reply_to data")

        if reply_to.get("nonce"):
            decrypted_reply_content = await asyncio.to_thread(
                message_encryption.decrypt_message,
                reply_to["content"],
                reply_to["nonce"],
                room_id,
            )
        else:
            decrypted_reply_content = reply_to.get(
                "content", "Original reply content unavailable"
            )

        return {
            "message_id": message_id,
            "content": decrypted_reply_content,
            "username": reply_to["username"],
        }
    except Exception as e:
        print(f"Error processing reply content: {e}")
        return {
            "message_id": message_id if "message_id" in locals() else None,
            "content": "Error processing reply content",
            "username": reply_to.get("username", "Unknown"),
        }


async def handle_new_message(
    manager,
    db,
    message_data: dict,
    user: dict,
    room: dict,
    room_id: str,
    message_encryption,
):
    """Handle new messages with compression, encryption, and push notifications."""
    database = await db.db
    reply_content = None
    
    try:
        if 'content' not in message_data:
            raise ValueError("Message content is required")
            
        message_type = message_data.get("message_type", "text")
        
        # Process reply_to data if present
        if message_data.get("reply_to"):
            # Ensure reply_to has consistent message ID field
            reply_to_data = message_data["reply_to"]
            if "id" in reply_to_data and "message_id" not in reply_to_data:
                reply_to_data["message_id"] = reply_to_data["id"]
            
        # Don't compress images or very short messages
        if message_type == "text" and len(message_data["content"]) >= 100:
            compressed_content, is_compressed = message_compression.compress_message(
                message_data["content"]
            )
            message_data["content"] = compressed_content
        else:
            is_compressed = False

        # Existing encryption logic
        if message_type == "image":
            encrypted_content = message_data["content"]
            nonce = None
            encrypted = False
            
            if message_data.get("reply_to"):
                reply_content = await process_reply_content(
                    message_data.get("reply_to"), message_encryption, room_id
                )
        else:
            tasks = []
            
            if message_data["content"]:
                tasks.append(
                    asyncio.to_thread(
                        message_encryption.encrypt_message,
                        message_data["content"],
                        room_id,
                    )
                )
            
            if message_data.get("reply_to"):
                tasks.append(
                    process_reply_content(
                        message_data.get("reply_to"), message_encryption, room_id
                    )
                )
                
            results = await asyncio.gather(*tasks)
            
            if len(tasks) == 2:
                content, reply_content = results
            elif message_data.get("reply_to"):
                reply_content = results[0]
                content = (None, None)
            else:
                content = results[0]
                
            encrypted_content, nonce = content
            encrypted = True

        # Add compression flag to message document
        message = {
            "content": encrypted_content,
            "nonce": nonce,
            "username": user["username"],
            "timestamp": datetime.utcnow(),
            "user_id": str(user["_id"]),
            "room_id": room_id,
            "room_name": room["name"],
            "encrypted": encrypted,
            "compressed": is_compressed,
            "message_type": message_type,
            "reply_to": message_data.get("reply_to"),
            "read_by": [str(user["_id"])],
        }

        write_concern = WriteConcern(w=1, j=False)
        coll = database.get_collection('messages', write_concern=write_concern)
        
        result = await coll.insert_one(message)
        message["_id"] = result.inserted_id

        if message_type == "image":
            decrypted_content = encrypted_content
        else:
            decrypted_content = await asyncio.to_thread(
                message_encryption.decrypt_message,
                encrypted_content,
                nonce,
                room_id,
            ) if encrypted_content else ""
            
            # Decompress after decryption if needed
            if is_compressed:
                decrypted_content = message_compression.decompress_message(
                    decrypted_content, True
                )

        broadcast_message = {
            "type": "message",
            "message_type": message_type,
            "id": str(message["_id"]),
            "temp_id": message_data.get("temp_id"),
            "content": decrypted_content,
            "username": message["username"],
            "timestamp": message["timestamp"].isoformat(),
            "room_id": room_id,
            "room_name": room["name"],
            "reply_to": reply_content,
            "read_by": message["read_by"],
        }

        asyncio.create_task(manager.broadcast(broadcast_message, room_id))
        
        # Send push notifications to users in the room who are not the sender
        asyncio.create_task(
            send_message_notifications(
                database,
                user,
                room,
                decrypted_content,
                message_type
            )
        )
        
        return broadcast_message

    except Exception as e:
        print(f"Message handling error: {str(e)}")
        import traceback
        print(traceback.format_exc())
        raise


@app.websocket("/ws/{token}/{room_id}")
async def websocket_endpoint(websocket: WebSocket, token: str, room_id: str):
    """WebSocket endpoint with Firebase token verification."""
    user_id = None
    
    # Accept connection first to prevent "need to call accept first" error
    await websocket.accept()
    
    # Create handler mapping outside the loop for better performance
    handlers = None

    try:
        # Now verify Firebase token
        try:
            # Decode the Firebase ID token
            decoded_token = firebase_auth.verify_id_token(token)
            firebase_uid = decoded_token["uid"]

            # Get database connection
            database = await db.db

            # Concurrent fetch of user and room data
            user, room = await asyncio.gather(
                database.users.find_one({"firebase_uid": firebase_uid}),
                database.rooms.find_one({"_id": ObjectId(room_id)}),
            )

            if not user or not room:
                print(f"User or room not found. User: {user}, Room: {room}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            user_id = str(user["_id"])
            
            # Now register with the ConnectionManager
            await manager.connect(websocket, user_id, room_id)

        except firebase_auth.InvalidIdTokenError as e:
            print(f"Invalid Firebase token: {str(e)}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Create handlers mapping once - better performance than recreating each loop
        handlers = {
            "typing_status": lambda data: handle_typing_status(
                manager, data, user, room_id
            ),
            "add_emoji_reaction": lambda data: handle_emoji_reaction(
                manager, db, data, user, room_id
            ),
            "edit_message": lambda data: handle_message_edit(
                manager, db, data, user_id, room_id, message_encryption
            ),
            "delete_message": lambda data: handle_message_delete(
                manager, db, data, user_id, room_id
            ),
            "read_receipt": lambda data: handle_read_receipt(
                manager, db, user_id, room_id, data.get("message_ids", [])
            ),
            "presence_update": lambda data: handle_presence_update(
                manager, data, user_id, room_id
            ),
        }

        # Message handling loop
        while True:
            data = await websocket.receive_text()

            # Fast path for ping messages
            if data == "ping":
                await handle_presence_ping(manager, user_id, room_id)
                continue

            try:
                # Parse JSON only once
                message_data = json.loads(data)
                message_type = message_data.get("type")

                # Handle special message types efficiently
                if message_type in handlers:
                    await handlers[message_type](message_data)
                    continue

                # Process regular messages
                if message_type == "message":
                    # Fast validation check
                    if "content" not in message_data:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Message missing required 'content' field",
                            }
                        )
                        continue

                    # Process message in a way that allows concurrent message handling
                    asyncio.create_task(
                        handle_new_message(
                            manager,
                            db,
                            message_data,
                            user,
                            room,
                            room_id,
                            message_encryption,
                        )
                    )
                else:
                    print(f"Unhandled message type: {message_type}")

            except json.JSONDecodeError:
                # Fast error path - don't do expensive processing
                continue
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                continue

    except WebSocketDisconnect:
        if user_id:
            await handle_disconnect(manager, user_id, room_id)
    except Exception as e:
        print(f"Websocket error: {str(e)}")
        if user_id:
            await handle_disconnect(manager, user_id, room_id)

async def handle_disconnect(manager, user_id: str, room_id: str):
    """Optimized disconnect handler"""
    if user_id:
        # Update presence first, then broadcast
        await manager.update_presence(user_id, room_id, "offline")

        # Broadcast offline status to all users in room
        asyncio.create_task(
            manager.broadcast(
                {
                    "type": "presence",
                    "user_id": user_id,
                    "status": "offline",
                    "room_id": room_id,
                },
                room_id,
            )
        )


# FCM Token endpoints
@app.post("/users/fcm-tokens")
async def register_fcm_token(
    token_data: FCMTokenCreate, current_user: dict = Depends(get_current_user)
):
    """Register a FCM token for the current user."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Create token document
    token_doc = {
        "token": token_data.token,
        "device_id": token_data.device_id,
        "device_type": token_data.device_type,
        "user_id": user_id,
        "created_at": datetime.utcnow(),
        "last_used": datetime.utcnow(),
    }

    try:
        # Upsert to handle token updates for same device
        result = await database.fcm_tokens.update_one(
            {"device_id": token_data.device_id, "user_id": user_id},
            {"$set": token_doc},
            upsert=True,
        )

        return {"message": "FCM token registered successfully"}
    except pymongo.errors.DuplicateKeyError:
        # If the token already exists but for a different user/device,
        # update it to the current user
        await database.fcm_tokens.update_one(
            {"token": token_data.token}, {"$set": token_doc}
        )
        return {"message": "FCM token updated successfully"}


@app.delete("/users/fcm-tokens/{token}")
async def delete_fcm_token(token: str, current_user: dict = Depends(get_current_user)):
    """Delete a FCM token for the current user."""
    database = await db.db
    user_id = str(current_user["_id"])

    result = await database.fcm_tokens.delete_one({"token": token, "user_id": user_id})

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Token not found"
        )

    return {"message": "FCM token deleted successfully"}


@app.post("/notifications")
async def send_notification(
    notification: PushNotification, current_user: dict = Depends(get_current_user)
):
    """Send a notification to specified users or topics."""
    database = await db.db

    # Ensure the user has permission to send notifications
    # Add your permission checks here

    # Determine who to send to
    if notification.token:
        # Send to a specific token
        result = await fcm_service.send_to_token(
            notification.token,
            notification.title,
            notification.body,
            notification.data,
            notification.image_url,
        )
        return {"message": "Notification sent", "message_id": result}

    elif notification.topic:
        # Send to a topic
        result = await fcm_service.send_to_topic(
            notification.topic,
            notification.title,
            notification.body,
            notification.data,
            notification.image_url,
        )
        return {"message": "Notification sent to topic", "message_id": result}

    elif notification.user_ids:
        # Send to multiple users
        # Get all tokens for these users
        tokens_cursor = database.fcm_tokens.find(
            {"user_id": {"$in": notification.user_ids}}
        )
        tokens = [doc["token"] async for doc in tokens_cursor]

        if not tokens:
            return {"message": "No tokens found for specified users"}

        results = await fcm_service.send_to_tokens(
            tokens,
            notification.title,
            notification.body,
            notification.data,
            notification.image_url,
        )
        return {"message": "Notifications sent to users", "results": results}

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must specify at least one of: token, topic, or user_ids",
        )
    
async def send_message_notifications(database, sender, room, content, message_type):
    """Send push notifications for new messages."""
    try:
        # Get room members excluding the sender
        room_id = str(room["_id"])
        room_name = room["name"]
        sender_id = str(sender["_id"])
        sender_name = sender["username"]
        
        # Get room member ids
        memberships = database.room_memberships.find({"room_id": room_id})
        member_ids = []
        async for doc in memberships:
            member_id = doc["user_id"]
            if member_id != sender_id:  # Exclude sender
                member_ids.append(member_id)
                
        if not member_ids:
            return
            
        # Get FCM tokens for these users
        tokens_cursor = database.fcm_tokens.find({"user_id": {"$in": member_ids}})
        tokens = [doc["token"] async for doc in tokens_cursor]
        
        if not tokens:
            return
            
        # Prepare notification content
        title = f"{sender_name} in {room_name}"
        
        # Truncate message content for notification
        if message_type == "text":
            # Truncate and clean content for notification
            preview = content[:100]
            if len(content) > 100:
                preview += "..."
            body = preview
        elif message_type == "image":
            body = "Sent an image"
        else:
            body = f"Sent a {message_type}"
            
        # Prepare data payload with camelCase keys
        data = {
            "roomId": str(room_id),
            "senderId": str(sender_id),
            "messageType": str(message_type)
        }
        
        # Send to all tokens in batches
        await fcm_service.send_to_tokens(
            tokens,
            title,
            body,
            data=data
        )
        
    except Exception as e:
        print(f"Error sending message notifications: {str(e)}")

# Message endpoints
@functools.lru_cache(maxsize=100)
def get_message_query_projection():
    """Cache the projection to avoid rebuilding it for each query"""
    return {
        "_id": 1,
        "content": 1,
        "nonce": 1,
        "username": 1,
        "timestamp": 1,
        "room_id": 1,
        "room_name": 1,
        "encrypted": 1,
        "reply_to": 1,
        "reactions": 1,
        "edited": 1,
        "edited_at": 1,
        "read_by": 1,
        "message_type": 1,
    }


async def get_messages_optimized(
    room_id: str,
    limit: int = Query(default=50, le=100),
    cursor: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """Optimized message retrieval with compression support"""
    database = await db.db

    query = {"room_id": room_id}
    if cursor:
        try:
            cursor_timestamp = datetime.fromisoformat(
                base64.b64decode(cursor).decode("utf-8")
            )
            query["timestamp"] = {"$lt": cursor_timestamp}
        except:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    # Add explicit check for compression field
    projection = {
        **get_message_query_projection(),
        "compressed": 1,  # Ensure we get the compressed field
    }

    read_preference = ReadPreference.SECONDARY_PREFERRED
    coll = database.get_collection("messages", read_preference=read_preference)

    cursor = coll.find(query, projection).sort("timestamp", -1).limit(limit + 1)
    messages = [msg async for msg in cursor]

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:-1]

    # Process messages in batches
    batch_size = 20
    for i in range(0, len(messages), batch_size):
        batch = messages[i : i + batch_size]
        await message_compression.process_message_batch(
            batch, room_id, message_encryption
        )

    # Build response messages
    response_messages = []
    for msg in messages:
        msg_id = str(msg["_id"])

        processed_msg = {
            "id": msg_id,
            "content": msg["content"],
            "username": msg["username"],
            "timestamp": msg["timestamp"],
            "room_id": msg["room_id"],
            "room_name": msg.get("room_name"),
            "encrypted": msg.get("encrypted", True),
            "compressed": msg.get("compressed", False),
            "nonce": msg.get("nonce"),
            "reply_to": msg.get("reply_to"),
            "reactions": msg.get("reactions", {}),
            "edited": msg.get("edited", False),
            "edited_at": msg.get("edited_at"),
            "read_by": msg.get("read_by", []),
            "message_type": msg.get("message_type", "text"),
        }
        response_messages.append(MessageResponse(**processed_msg))

    next_cursor = None
    if has_more and messages:
        last_timestamp = messages[-1]["timestamp"].isoformat()
        next_cursor = base64.b64encode(last_timestamp.encode("utf-8")).decode("utf-8")

    return {"messages": response_messages, "next_cursor": next_cursor}


@app.get("/messages/{room_id}", response_model=dict)
async def get_messages(
    room_id: str,
    limit: int = Query(default=50, le=100),
    cursor: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """Get messages for a room with optimized performance."""
    return await get_messages_optimized(room_id, limit, cursor, current_user)

# Helper functions for rooms
async def generate_room_code() -> str:
    """Generate unique room code."""
    db_instance = await db.db
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        existing_room = await db_instance.rooms.find_one({"code": code})
        if not existing_room:
            return code


async def get_room_by_code(code: str) -> Optional[dict]:
    """Get room by code."""
    database = await db.db
    return await database.rooms.find_one({"code": code})


async def get_room_by_id(room_id: str) -> Optional[dict]:
    """Get room by ID."""
    try:
        database = await db.db
        return await database.rooms.find_one({"_id": ObjectId(room_id)})
    except pymongo.errors.PyMongoError:
        return None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    """Get user by ID."""
    try:
        database = await db.db
        return await database.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return None


async def get_invite_by_id(invite_id: str) -> Optional[dict]:
    """Get invite by ID."""
    try:
        database = await db.db
        return await database.room_invites.find_one({"_id": ObjectId(invite_id)})
    except Exception:
        return None


async def check_room_membership(user_id: str, room_id: str) -> bool:
    """Check if a user is a member of a room."""
    database = await db.db
    
    print(f"DEBUG - Checking membership: user_id={user_id}, room_id={room_id}")
    
    # Find room and check if user is in members array
    room = await database.rooms.find_one({
        "_id": ObjectId(room_id),
        "members.user_id": user_id
    })
    
    is_member = room is not None
    print(f"DEBUG - Membership check result: {is_member}")
    
    return is_member


async def check_existing_invite(user_id: str, room_id: str) -> bool:
    """Check if there's already a pending invite for this user and room."""
    database = await db.db
    invite = await database.room_invites.find_one({
        "user_id": user_id,
        "room_id": room_id,
        "status": "pending"
    })
    return invite is not None


# Room Routes
@app.post("/rooms", response_model=RoomResponse)
async def create_room(room: RoomCreate, current_user: dict = Depends(get_current_user)):
    """Create new chat room with creator as first member."""
    code = await generate_room_code()
    user_id = str(current_user["_id"])
    
    # Create initial member record for creator
    creator_member = RoomMember(
        user_id=user_id,
        username=current_user["username"],
        email=current_user["email"],
        joined_at=datetime.utcnow()
    )
    
    room_dict = {
        "name": room.name,
        "code": code,
        "created_by": current_user["email"],
        "created_at": datetime.utcnow(),
        "members": [creator_member.model_dump()]
    }
    
    database = await db.db
    result = await database.rooms.insert_one(room_dict)
    
    # Create initial read receipt
    await database.read_receipts.insert_one({
        "user_id": user_id,
        "room_id": str(result.inserted_id),
        "timestamp": datetime.utcnow()
    })
    
    response_dict = {
        "id": str(result.inserted_id),
        "name": room.name,
        "code": code,
        "created_by": current_user["email"],
        "created_at": room_dict["created_at"],
        "members": [current_user["username"]],
        "is_owner": True,
        "unread_count": 0
    }
    
    return RoomResponse(**response_dict)


@app.post("/rooms/join", response_model=RoomResponse)
async def join_room(room_join: RoomJoin, current_user: dict = Depends(get_current_user)):
    """Join existing room by code."""
    database = await db.db
    room = await get_room_by_code(room_join.code)
    
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    user_id = str(current_user["_id"])
    room_id = str(room["_id"])
    
    # Check if user is already a member
    is_member = await check_room_membership(user_id, room_id)
    if is_member:
        # User is already a member, just return the room
        pass
    else:
        # Add user to room members
        new_member = RoomMember(
            user_id=user_id,
            username=current_user["username"],
            email=current_user["email"],
            joined_at=datetime.utcnow()
        )
        
        await database.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$push": {"members": new_member.model_dump()}}
        )
        
        # Create initial read receipt
        await database.read_receipts.insert_one({
            "user_id": user_id,
            "room_id": room_id,
            "timestamp": datetime.utcnow()
        })
    
    # Get unread count for this room
    last_read = await database.read_receipts.find_one(
        {"user_id": user_id, "room_id": room_id}
    )
    last_read_time = last_read["timestamp"] if last_read else datetime.min
    
    unread_count = await database.messages.count_documents({
        "room_id": room_id,
        "timestamp": {"$gt": last_read_time},
        "username": {"$ne": current_user["username"]}
    })
    
    # Get updated room with new member
    updated_room = await get_room_by_id(room_id)
    
    # Extract usernames for response
    member_usernames = [member["username"] for member in updated_room.get("members", [])]
    
    return RoomResponse(
        id=room_id,
        name=room["name"],
        code=room["code"],
        created_by=room["created_by"],
        created_at=room["created_at"],
        members=member_usernames,
        is_owner=room["created_by"] == current_user["email"],
        unread_count=unread_count
    )


@app.get("/rooms", response_model=List[RoomResponse])
async def get_user_rooms(current_user: dict = Depends(get_current_user)):
    """Get rooms where user is a member."""
    user_id = str(current_user["_id"])
    user_email = current_user["email"]
    database = await db.db
    
    # Find all rooms where user is a member
    rooms_cursor = database.rooms.find({
        "members.user_id": user_id
    })
    
    rooms = await rooms_cursor.to_list(length=100)
    result = []
    
    for room in rooms:
        # Get last read timestamp
        last_read = await database.read_receipts.find_one(
            {"user_id": user_id, "room_id": str(room["_id"])}
        )
        last_read_time = last_read["timestamp"] if last_read else datetime.min
        
        # Get unread count
        unread_count = await database.messages.count_documents({
            "room_id": str(room["_id"]),
            "timestamp": {"$gt": last_read_time},
            "username": {"$ne": current_user["username"]}
        })
        
        # Extract member usernames
        member_usernames = [member["username"] for member in room.get("members", [])]
        
        result.append(RoomResponse(
            id=str(room["_id"]),
            name=room["name"],
            code=room["code"],
            created_by=room["created_by"],
            created_at=room["created_at"],
            members=member_usernames,
            is_owner=room["created_by"] == user_email,
            unread_count=unread_count
        ))
    
    return result


@app.get("/rooms/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single room by ID."""
    database = await db.db
    user_id = str(current_user["_id"])
    
    # Get room document
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check if user is a member
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a member of this room")
    
    # Get unread count
    last_read = await database.read_receipts.find_one(
        {"user_id": user_id, "room_id": room_id}
    )
    last_read_time = last_read["timestamp"] if last_read else datetime.min
    
    unread_count = await database.messages.count_documents({
        "room_id": room_id,
        "timestamp": {"$gt": last_read_time},
        "username": {"$ne": current_user["username"]}
    })
    
    # Extract member usernames
    member_usernames = [member["username"] for member in room.get("members", [])]
    
    return RoomResponse(
        id=room_id,
        name=room["name"],
        code=room["code"],
        created_by=room["created_by"],
        created_at=room["created_at"],
        members=member_usernames,
        is_owner=room["created_by"] == current_user["email"],
        unread_count=unread_count
    )


@app.delete("/rooms/{room_id}/leave")
async def leave_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Leave a room (remove user from members)."""
    user_id = str(current_user["_id"])
    database = await db.db
    
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Don't allow creator to leave their own room
    if room["created_by"] == current_user["email"]:
        raise HTTPException(
            status_code=400,
            detail="Room creator cannot leave their own room. Delete the room instead."
        )
    
    # Remove user from members array
    result = await database.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$pull": {"members": {"user_id": user_id}}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Not a member of this room")
    
    # Remove read receipt
    await database.read_receipts.delete_one({
        "user_id": user_id,
        "room_id": room_id
    })
    
    return {"message": "Successfully left the room"}


@app.delete("/rooms/{room_id}")
async def delete_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Delete room and its messages."""
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    if room["created_by"] != current_user["email"]:
        raise HTTPException(
            status_code=403, detail="Only room creator can delete the room"
        )
    
    database = await db.db
    
    # Delete room and all related data
    await database.rooms.delete_one({"_id": ObjectId(room_id)})
    await database.messages.delete_many({"room_id": room_id})
    await database.read_receipts.delete_many({"room_id": room_id})
    await database.room_invites.delete_many({"room_id": room_id})
    
    return {"message": "Room and related data deleted successfully"}


@app.get("/rooms/{room_id}/members", response_model=List[dict])
async def get_room_members(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get all members of a room."""
    user_id = str(current_user["_id"])
    database = await db.db
    
    # Check if the user is a member of the room
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to view room members")
    
    # Get room with members
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Extract member details
    members = []
    for member in room.get("members", []):
        members.append({
            "id": member["user_id"],
            "username": member["username"],
            "email": member["email"],
            "joined_at": member["joined_at"]
        })
    
    return members


# Invite Routes

@app.get("/users/search", response_model=List[dict])
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    """Search for users by username or email."""
    # Skip empty queries
    if not q or len(q.strip()) < 2:
        return []
    
    database = await db.db
    query_term = q.strip().lower()
    
    # Create a case-insensitive regex pattern for the search
    pattern = re.compile(f".*{re.escape(query_term)}.*", re.IGNORECASE)
    
    # Search for users by username or email
    users_cursor = database.users.find({
        "$or": [
            {"username": {"$regex": pattern}},
            {"email": {"$regex": pattern}}
        ]
    })
    
    # Limit to reasonable number of results
    users = await users_cursor.to_list(length=20)
    
    # Format results to match frontend expectations
    results = []
    for user in users:
        # Don't include the current user in search results
        if str(user["_id"]) == str(current_user["_id"]):
            continue
            
        results.append({
            "id": str(user["_id"]),
            "username": user["username"],
            "email": user["email"]
        })
    
    return results

@app.post("/room/invite", response_model=dict)
async def invite_user_to_room(invite: RoomInviteCreate, current_user: dict = Depends(get_current_user)):
    """Invite a user to a room."""
    database = await db.db
    user_id = str(current_user["_id"])
    print(f"Received invite request: {invite}")
    print(f"Model validation format expected: {RoomInviteCreate.schema_json(indent=2)}")
    
    # Validate room exists
    room = await get_room_by_id(invite.room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check if current user is a member
    is_member = await check_room_membership(user_id, invite.room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to invite users to this room")
    
    # Validate target user exists
    target_user = await get_user_by_id(invite.userId)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if user is already a member
    is_already_member = await check_room_membership(invite.userId, invite.room_id)
    if is_already_member:
        raise HTTPException(status_code=400, detail="User is already a member of this room")
    
    # Check if there's already a pending invite
    has_invite = await check_existing_invite(invite.userId, invite.room_id)
    if has_invite:
        raise HTTPException(status_code=400, detail="User already has a pending invite to this room")
    
    # Create the invite
    invite_data = RoomInvite(
        room_id=invite.room_id,
        user_id=invite.userId,
        invited_by=current_user["email"]
    )
    
    result = await database.room_invites.insert_one(invite_data.model_dump())
    
    return {
        "success": True,
        "message": f"Invite sent to {target_user['username']}",
        "inviteId": str(result.inserted_id)
    }


@app.get("/invites/pending", response_model=List[RoomInviteResponse])
async def get_pending_invites(current_user: dict = Depends(get_current_user)):
    """Get all pending invites for the current user."""
    database = await db.db
    user_id = str(current_user["_id"])
    
    # Find all pending invites for the user
    invites_cursor = database.room_invites.find({
        "user_id": user_id,
        "status": "pending"
    })
    
    invites = await invites_cursor.to_list(length=100)
    
    # If no invites, return empty list
    if not invites:
        return []
    
    # Get room details for each invite
    result = []
    for invite in invites:
        room = await get_room_by_id(invite["room_id"])
        if not room:
            continue
            
        # Get inviter username
        inviter = await database.users.find_one({"email": invite["invited_by"]})
        inviter_name = inviter["username"] if inviter else "Unknown"
        
        result.append(RoomInviteResponse(
            id=str(invite["_id"]),
            room_id=invite["room_id"],
            room_name=room["name"],
            invited_by=invite["invited_by"],
            invitedBy=inviter_name,
            userId=invite["user_id"],
            username=current_user["username"],
            status=invite["status"],
            created_at=invite["created_at"]
        ))
    
    return result


@app.get("/rooms/{room_id}/invites", response_model=List[RoomInviteResponse])
async def get_room_invites(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get all pending invites for a specific room."""
    database = await db.db
    user_id = str(current_user["_id"])
    
    # Verify the user is a member of the room
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to view room invites")
    
    # Find all pending invites for the room
    invites_cursor = database.room_invites.find({
        "room_id": room_id,
        "status": "pending"
    })
    
    invites = await invites_cursor.to_list(length=100)
    
    # Get user details for each invite
    result = []
    for invite in invites:
        user = await get_user_by_id(invite["user_id"])
        if not user:
            continue
            
        result.append(RoomInviteResponse(
            id=str(invite["_id"]),
            room_id=invite["room_id"],
            room_name="",  # Not needed in this context
            invited_by=invite["invited_by"],
            invitedBy="",  # Not needed in this context
            userId=invite["user_id"],
            username=user["username"],
            status=invite["status"],
            created_at=invite["created_at"]
        ))
    
    return result


@app.post("/invites/{invite_id}/accept", response_model=InviteActionResponse)
async def accept_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Accept a room invitation."""
    database = await db.db
    user_id = str(current_user["_id"])
    
    # Get the invite
    invite = await get_invite_by_id(invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    # Verify the invite belongs to the current user
    if invite["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to accept this invite")
    
    # Verify the invite is still pending
    if invite["status"] != "pending":
        raise HTTPException(status_code=400, detail="Invite is no longer pending")
    
    # Get the room
    room = await get_room_by_id(invite["room_id"])
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Update the invite status
    await database.room_invites.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "accepted"}}
    )
    
    # Check if user is already a member (edge case)
    is_member = await check_room_membership(user_id, invite["room_id"])
    if not is_member:
        # Add user to room members
        new_member = RoomMember(
            user_id=user_id,
            username=current_user["username"],
            email=current_user["email"],
            joined_at=datetime.utcnow()
        )
        
        await database.rooms.update_one(
            {"_id": ObjectId(invite["room_id"])},
            {"$push": {"members": new_member.model_dump()}}
        )
    
    # Create initial read receipt if it doesn't exist
    read_receipt = await database.read_receipts.find_one({
        "user_id": user_id,
        "room_id": invite["room_id"]
    })
    
    if not read_receipt:
        await database.read_receipts.insert_one({
            "user_id": user_id,
            "room_id": invite["room_id"],
            "timestamp": datetime.utcnow()
        })
    
    return InviteActionResponse(
        success=True,
        roomId=invite["room_id"],
        message=f"Successfully joined {room['name']}"
    )


@app.post("/invites/{invite_id}/decline", response_model=InviteActionResponse)
async def decline_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Decline a room invitation."""
    database = await db.db
    user_id = str(current_user["_id"])
    
    # Get the invite
    invite = await get_invite_by_id(invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    # Verify the invite belongs to the current user
    if invite["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to decline this invite")
    
    # Verify the invite is still pending
    if invite["status"] != "pending":
        raise HTTPException(status_code=400, detail="Invite is no longer pending")
    
    # Update the invite status
    await database.room_invites.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "declined"}}
    )
    
    return InviteActionResponse(
        success=True,
        roomId=invite["room_id"],
        message="Invitation declined"
    )

# Page endpoints
@app.get("/", response_class=HTMLResponse)
async def landing(request: Request):
    """landing page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/chat", response_class=HTMLResponse)
async def chat_landing(request: Request):
    """Chat landing page showing all user rooms."""
    return templates.TemplateResponse(
        "chat.html", {"request": request}
    )

@app.get("/chat/{room_id}", response_class=HTMLResponse)
async def chat_room(request: Request, room_id: str):
    """Chat room page."""
    return templates.TemplateResponse(
        "chat.html", {"request": request, "room_id": room_id}
    )

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/sentry-debug")
async def trigger_error():
    division_by_zero = 1 / 0


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login page."""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    """Register page."""
    return templates.TemplateResponse("register.html", {"request": request})

@app.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password(request: Request):
    """Forgot password page."""
    return templates.TemplateResponse("forgot-password.html", {"request": request})


@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    """User settings page."""
    return templates.TemplateResponse("settings.html", {"request": request})

@app.get("/service-worker.js", response_class=FileResponse)
async def service_worker():
    file_path = os.path.join(os.getcwd(), "static", "service-worker.js")
    return FileResponse(file_path, media_type="application/javascript")

@app.get("/firebase-messaging-sw.js", response_class=FileResponse)
async def firebase_messaging_sw():
    file_path = os.path.join(os.getcwd(), "static", "firebase-messaging-sw.js")
    return FileResponse(file_path, media_type="application/javascript")

#uvicorn main:app --host 0.0.0.0 --port 8000 --ssl-keyfile=key.pem --ssl-certfile=cert.pem --reload --log-level debug
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=True)