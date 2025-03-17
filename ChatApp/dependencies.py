# Standard library imports
import logging
import os

# Third-party imports
from cachetools import TTLCache
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext

from ChatApp.compression import MessageCompression
from ChatApp.db import Database
from ChatApp.message_encryption import MessageEncryption
from ChatApp.settings import Settings

# Configure logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# Config
settings = Settings()

# Initialize database
db = Database()

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
MIN_SCORE = 0.5

# Compression and encryption
message_encryption = MessageEncryption()
message_compression = MessageCompression()

# message cache -> before redis
message_cache = TTLCache(maxsize=1000, ttl=60)
