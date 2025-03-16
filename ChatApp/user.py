import os
import uuid
from datetime import datetime

import httpx
from fastapi import HTTPException, Depends, UploadFile, File
from firebase_admin import auth as firebase_auth, storage
from starlette import status
from starlette.requests import Request

from ChatApp.main import db, app, RECAPTCHA_SECRET_KEY, MIN_SCORE
from ChatApp.models import RecaptchaResponse, RecaptchaRequest, User


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
