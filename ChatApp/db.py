import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Dict, Optional, AsyncGenerator, List, Any

import pymongo
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from ChatApp.settings import Settings

# Configure logging
logger = logging.getLogger(__name__)

settings = Settings()


class ConnectionPool:
    """Manages a pool of MongoDB client connections."""

    def __init__(
        self,
        uri: str,
        min_pool_size: int = 10,
        max_pool_size: int = 50,
        max_idle_time_ms: int = 300000,
        retry_writes: bool = True,
    ):
        """Initialize the connection pool with configuration parameters.
        
        Args:
            uri: MongoDB connection string
            min_pool_size: Minimum number of connections in the pool
            max_pool_size: Maximum number of connections in the pool
            max_idle_time_ms: Maximum time a connection can remain idle before being closed
            retry_writes: Whether to retry write operations
        """
        self.uri = uri
        self.min_pool_size = min_pool_size
        self.max_pool_size = max_pool_size
        self.max_idle_time_ms = max_idle_time_ms
        self.retry_writes = retry_writes
        self._pools: Dict[str, AsyncIOMotorClient] = {}
        self._last_used: Dict[str, datetime] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task = None

    async def start(self):
        """Start the connection pool and background cleanup task."""
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup())
        logger.info("Connection pool started with cleanup task")

    async def _periodic_cleanup(self):
        """Periodically clean up idle connections."""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                await self._cleanup_idle_connections()
            except asyncio.CancelledError:
                logger.info("Cleanup task cancelled")
                break
            except Exception as e:
                logger.error(f"Error in connection cleanup: {e}")

    async def _cleanup_idle_connections(self):
        """Close connections that have been idle for too long."""
        now = datetime.utcnow()
        max_idle = timedelta(milliseconds=self.max_idle_time_ms)
        
        async with self._lock:
            to_remove = []
            
            for db_name, last_used in self._last_used.items():
                if now - last_used > max_idle:
                    to_remove.append(db_name)
            
            for db_name in to_remove:
                client = self._pools.pop(db_name, None)
                self._last_used.pop(db_name, None)
                
                if client:
                    try:
                        await client.close()
                        logger.debug(f"Closed idle connection for database: {db_name}")
                    except Exception as e:
                        logger.warning(f"Error closing idle connection: {e}")

    async def get_client(self, database_name: str) -> AsyncIOMotorClient:
        """Get a client from the pool or create a new one if needed.
        
        Args:
            database_name: Name of the database to connect to
            
        Returns:
            AsyncIOMotorClient: MongoDB client
            
        Raises:
            ConnectionError: If connection fails
        """
        async with self._lock:
            client = self._pools.get(database_name)

            if client:
                try:
                    # Check if client is valid with a short timeout
                    await asyncio.wait_for(client.admin.command("ping"), timeout=2.0)
                    self._last_used[database_name] = datetime.utcnow()
                    return client
                except (pymongo.errors.PyMongoError, asyncio.TimeoutError) as e:
                    logger.warning(f"Connection test failed for {database_name}: {e}")
                    # Remove from pool before closing
                    if database_name in self._pools:
                        old_client = self._pools.pop(database_name, None)
                        self._last_used.pop(database_name, None)

                        if old_client:
                            try:
                                await old_client.close()
                            except Exception as e:
                                logger.warning(f"Error closing failed connection: {e}")

            # Create new client
            client = await self._create_client(database_name)
            if not client:
                raise ConnectionError(
                    f"Failed to create MongoDB client for database {database_name}"
                )
            return client

    async def _create_client(self, database_name: str) -> Optional[AsyncIOMotorClient]:
        """Create and test a new MongoDB client.
        
        Args:
            database_name: Name of the database to connect to
            
        Returns:
            Optional[AsyncIOMotorClient]: MongoDB client if successful, None otherwise
            
        Raises:
            ConnectionError: If connection fails
        """
        try:
            logger.debug(f"Creating new client for database: {database_name}")
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

            # Try to connect with a reasonable timeout
            await asyncio.wait_for(client.admin.command("ping"), timeout=5.0)
            self._pools[database_name] = client
            self._last_used[database_name] = datetime.utcnow()
            logger.info(f"Successfully connected to database: {database_name}")
            return client

        except Exception as e:
            if "client" in locals():
                try:
                    await client.close()
                except Exception as inner_e:
                    logger.warning(f"Error closing failed connection: {inner_e}")
            
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise ConnectionError(f"Failed to connect to MongoDB: {e}") from e

    async def close_all(self):
        """Close all database connections in the pool."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        async with self._lock:
            logger.info(f"Closing all connections ({len(self._pools)} clients)")
            for db_name, client in list(self._pools.items()):
                try:
                    await client.close()
                    logger.debug(f"Closed connection to {db_name}")
                except Exception as e:
                    logger.warning(f"Error closing connection to {db_name}: {e}")
            
            self._pools.clear()
            self._last_used.clear()


class Database:
    """Main database interface class for the application."""

    def __init__(self):
        """Initialize database with connection pool."""
        self.connection_pool: Optional[ConnectionPool] = None
        self._database_name: Optional[str] = None
        self._lock = asyncio.Lock()
        self._initialized = False

    async def connect(self, database_name: str = settings.DATABASE_NAME):
        """Connect to MongoDB using connection pool.
        
        Args:
            database_name: Name of the database to connect to
            
        Raises:
            ConnectionError: If connection fails
        """
        async with self._lock:
            if not self._initialized:
                logger.info(f"Initializing database connection to {database_name}")
                self.connection_pool = ConnectionPool(
                    uri=settings.MONGODB_URL,
                    min_pool_size=10,
                    max_pool_size=50,
                    max_idle_time_ms=300000,  # 5 minutes
                )
                await self.connection_pool.start()
                self._initialized = True
                
            self._database_name = database_name
            await self.connection_pool.get_client(database_name)
            await self.create_indexes()
            logger.info(f"Successfully connected to database {database_name}")

    @property
    async def db(self) -> AsyncIOMotorDatabase:
        """Get current database instance with automatic reconnection.
        
        Returns:
            AsyncIOMotorDatabase: Database instance
            
        Raises:
            RuntimeError: If database not initialized
        """
        if not self._database_name or not self._initialized:
            raise RuntimeError("Database not initialized. Call connect() first.")

        client = await self.connection_pool.get_client(self._database_name)
        return client[self._database_name]

    @asynccontextmanager
    async def get_client(self) -> AsyncGenerator[AsyncIOMotorClient, None]:
        """Context manager for getting a database client with automatic reconnection.
        
        Yields:
            AsyncIOMotorClient: MongoDB client
            
        Raises:
            RuntimeError: If database not initialized
            pymongo.errors.PyMongoError: If database operation fails
        """
        if not self._database_name or not self._initialized:
            raise RuntimeError("Database not initialized. Call connect() first.")

        try:
            client = await self.connection_pool.get_client(self._database_name)
            yield client
        except pymongo.errors.PyMongoError as e:
            logger.error(f"Error in database operation: {e}")
            raise

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncIOMotorClient, None]:
        """Context manager for transaction handling.
        
        This should be used when you need transaction support.
        Note: Requires MongoDB 4.0+ and a replica set.
        
        Yields:
            AsyncIOMotorClient: MongoDB client with active session
            
        Raises:
            RuntimeError: If database not initialized
            pymongo.errors.PyMongoError: If transaction fails
        """
        if not self._database_name or not self._initialized:
            raise RuntimeError("Database not initialized. Call connect() first.")

        client = await self.connection_pool.get_client(self._database_name)
        async with await client.start_session() as session:
            try:
                async with session.start_transaction():
                    yield client
            except pymongo.errors.PyMongoError as e:
                logger.error(f"Transaction failed: {e}")
                raise

    async def create_indexes(self):
        """Create necessary database indexes."""
        async with self.get_client() as client:
            db = client[self._database_name]
            
            indexes = self._get_index_definitions()
            index_creation_tasks = []
            
            for collection_name, collection_indexes in indexes.items():
                for index_spec in collection_indexes:
                    index_task = self._create_index(db[collection_name], index_spec)
                    index_creation_tasks.append(index_task)
            
            # Create all indexes in parallel
            await asyncio.gather(*index_creation_tasks)
            logger.info("All database indexes created successfully")

    def _get_index_definitions(self) -> Dict[str, List[Dict[str, Any]]]:
        """Define all database indexes.
        
        Returns:
            Dict: Collection names mapped to their index definitions
        """
        return {
            "users": [
                {"keys": [("email", 1)], "options": {"unique": True}},
                {"keys": [("username", 1)], "options": {"unique": True}},
                {"keys": [("last_active", -1)], "options": {}},
            ],
            "messages": [
                {"keys": [("timestamp", -1)], "options": {}},
                {"keys": [("room_id", 1), ("timestamp", -1)], "options": {}},
                {"keys": [("user_id", 1)], "options": {}},
            ],
            "rooms": [
                {"keys": [("code", 1)], "options": {"unique": True}},
                {"keys": [("created_by", 1)], "options": {}},
                {"keys": [("created_at", -1)], "options": {}},
            ],
            "room_memberships": [
                {"keys": [("user_id", 1), ("room_id", 1)], "options": {"unique": True}},
                {"keys": [("room_id", 1)], "options": {}},
                {"keys": [("user_id", 1)], "options": {}},
                {"keys": [("joined_at", -1)], "options": {}},
            ],
        }

    async def _create_index(self, collection, index_spec: Dict[str, Any]):
        """Create a single index on a collection.
        
        Args:
            collection: MongoDB collection
            index_spec: Index specification with keys and options
        """
        try:
            await collection.create_index(
                index_spec["keys"], **index_spec.get("options", {})
            )
            logger.debug(
                f"Created index {index_spec['keys']} on {collection.name}"
            )
        except pymongo.errors.PyMongoError as e:
            logger.error(f"Failed to create index on {collection.name}: {e}")
            raise

    async def close(self):
        """Close all database connections."""
        if self._initialized and self.connection_pool:
            logger.info("Closing database connections")
            await self.connection_pool.close_all()
            self._initialized = False