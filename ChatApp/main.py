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
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Import the app from app_instance
from ChatApp.app_instance import app
# Import dependencies from the dependencies module
from ChatApp.dependencies import db, message_encryption, message_compression
from ChatApp.ws_connection_manager import ConnectionManager

# Now these imports should work without circular dependencies
from ChatApp.notification_routes import notification_router
from ChatApp.template_routes import template_router

# Configure logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# Initialize connection manager
manager = ConnectionManager()

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


@asynccontextmanager
async def lifespan_context(app):
    """Manage app startup and shutdown with connection pooling."""
    try:
        max_retries = 3
        retry_delay = 5

        for attempt in range(max_retries):
            try:
                await db.connect()
                async with db.get_client() as client:
                    await client.admin.command("ping")
                print(f"✓ Successfully connected to database (attempt {attempt + 1}/{max_retries})")
                break
            except asyncio.TimeoutError as attempt_exception:
                if attempt == max_retries - 1:
                    raise RuntimeError("Database connection timeout after all retry attempts") from attempt_exception
                print(
                    f"× Connection attempt {attempt + 1}/{max_retries} timed out, retrying in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)
            except (pymongo.errors.PyMongoError, asyncio.TimeoutError) as e:
                if attempt == max_retries - 1:
                    raise RuntimeError(f"Failed to connect to database after {max_retries} attempts: {str(e)}") from e
                print(
                    f"× Connection attempt {attempt + 1}/{max_retries} failed: {str(e)}, retrying in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)

        async with db.get_client() as client:
            database = client[db._database_name]
            await database.fcm_tokens.create_index([("token", 1)], unique=True)
            await database.fcm_tokens.create_index([("user_id", 1)])
            await database.fcm_tokens.create_index([("device_id", 1)])

        # Initialize FCM service
        from ChatApp.fcm_service import fcm_service

        yield

    except Exception as e:
        print(f"! Critical error during startup: {str(e)}")
        raise

    finally:
        try:
            await db.close()
            print("✓ Database connections closed successfully")
        except asyncio.TimeoutError:
            print("! Warning: Database shutdown timed out")
        except Exception as e:
            print(f"! Warning: Error during database shutdown: {str(e)}")


# Apply the lifespan context
app.router.lifespan_context = lifespan_context

# Include routers from other modules
app.include_router(notification_router)
app.include_router(template_router)

# uvicorn main:app --host 0.0.0.0 --port 8000 --ssl-keyfile=key.pem --ssl-certfile=cert.pem --reload --log-level debug
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=True)