import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, Optional, AsyncGenerator

import pymongo
from motor.motor_asyncio import AsyncIOMotorClient

from ChatApp.settings import Settings

settings = Settings()


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
