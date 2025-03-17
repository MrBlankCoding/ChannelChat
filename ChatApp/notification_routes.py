from datetime import datetime

import pymongo
from fastapi import APIRouter, Depends, HTTPException
from starlette import status

from ChatApp.dependencies import db  # Import db from dependencies instead of main
from ChatApp.models import FCMTokenCreate, PushNotification
from ChatApp.user import get_current_user

# Create an APIRouter instance
notification_router = APIRouter(tags=["notifications"])


@notification_router.post("/users/fcm-tokens")
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


@notification_router.delete("/users/fcm-tokens/{token}")
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


@notification_router.post("/notifications")
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
