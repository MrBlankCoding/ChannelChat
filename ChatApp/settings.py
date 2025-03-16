import os

import firebase_admin
from firebase_admin import credentials


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
