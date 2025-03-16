# Standard library imports
import asyncio
import logging
import sys
import os
from contextlib import asynccontextmanager

# Add this line to include the ChatApp directory in the Python path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pymongo
import sentry_sdk
# Third-party imports
from cachetools import TTLCache
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from passlib.context import CryptContext

from ChatApp.compression import MessageCompression
from ChatApp.db import Database
from ChatApp.message_encryption import MessageEncryption
from ChatApp.push_notif_service import FirebaseNotificationService
from ChatApp.settings import Settings
from ChatApp.ws_connection_manager import ConnectionManager

# Configure logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# Load Vars
load_dotenv()

# Config
settings = Settings()

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

# Sentry
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

# uvicorn main:app --host 0.0.0.0 --port 8000 --ssl-keyfile=key.pem --ssl-certfile=cert.pem --reload --log-level debug
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=True)