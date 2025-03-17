import base64
from datetime import datetime
from typing import Optional

from fastapi import Query, Depends, HTTPException, APIRouter
from pymongo import ReadPreference

from ChatApp.dependencies import db, message_compression, message_encryption
from ChatApp.models import User, MessageResponse
from ChatApp.user import get_current_user

# Create a new router for message fetching
message_fetching_router = APIRouter()

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
        batch = messages[i: i + batch_size]
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


@message_fetching_router.get("/messages/{room_id}", response_model=dict)
async def get_messages(
        room_id: str,
        limit: int = Query(default=50, le=100),
        cursor: Optional[str] = None,
        current_user: User = Depends(get_current_user),
):
    """Get messages for a room with optimized performance."""
    return await get_messages_optimized(room_id, limit, cursor, current_user)