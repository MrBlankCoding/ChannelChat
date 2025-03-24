import asyncio
import json
from datetime import datetime
from typing import Dict, List, Callable, Awaitable, Any, Optional

import pymongo
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter
from firebase_admin import auth as firebase_auth
from pymongo import UpdateOne, WriteConcern
from starlette import status
from starlette.websockets import WebSocket, WebSocketDisconnect

from ChatApp.dependencies import db, message_compression
from ChatApp.message_encryption import MessageEncryption
from ChatApp.ws_connection_manager import ConnectionManager

# Create an instance of ConnectionManager
manager = ConnectionManager()

# Create a dedicated router for websockets
websocket_router = APIRouter()

# Initialize the message_encryption instance
message_encryption = MessageEncryption()


# Define a type for message handlers
MessageHandler = Callable[[Dict[str, Any]], Awaitable[Any]]


async def handle_presence_ping(user_id: str, room_id: str) -> None:
    """
    Handle presence ping with connection pooling.
    
    Args:
        user_id: The ID of the user sending the ping
        room_id: The ID of the room the user is in
    """
    await manager.update_presence(user_id, room_id, "active")


async def handle_presence_update(data: dict, user_id: str, room_id: str) -> None:
    """
    Handle presence update with connection pooling.
    
    Args:
        data: The presence data containing status and timestamp information
        user_id: The ID of the user updating their presence
        room_id: The ID of the room the user is in
    """
    status = data.get("status")

    # Handle the timestamp properly - extract from last_active string if timestamp not provided
    last_active = datetime.utcnow()  # Default value
    
    if timestamp := data.get("timestamp"):
        last_active = datetime.fromtimestamp(timestamp / 1000)
    elif last_active_str := data.get("last_active"):
        try:
            # Parse ISO format string to datetime
            last_active = datetime.fromisoformat(last_active_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass  # Use default value if parsing fails

    # Update presence directly with the ConnectionManager
    await manager.update_presence(user_id, room_id, status, last_active)


async def handle_typing_status(data: dict, user: dict, room_id: str) -> None:
    """
    Handle typing status with connection pooling.
    
    Args:
        data: The typing status data
        user: The user sending the typing status
        room_id: The ID of the room the user is in
    """
    typing_status = {
        "type": "typing_status",
        "username": user["username"],
        "is_typing": data.get("is_typing", False),
    }
    await manager.broadcast(typing_status, room_id)


async def handle_emoji_reaction(data: dict, user: dict, room_id: str) -> None:
    """
    Handle emoji reactions with connection pooling.
    
    Args:
        data: The emoji reaction data (message_id and emoji)
        user: The user adding the reaction
        room_id: The ID of the room containing the message
    """
    message_id = data.get("message_id")
    emoji = data.get("emoji")
    
    if not message_id or not emoji:
        return

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
    data: dict, user_id: str, room_id: str
) -> None:
    """
    Handle message editing with connection pooling.
    
    Args:
        data: The message edit data (message_id, new content, etc)
        user_id: The ID of the user editing the message
        room_id: The ID of the room containing the message
    """
    message_id = data.get("message_id")
    new_content = data.get("content")
    
    if not message_id or not new_content:
        return

    database = await db.db
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

        # Process reply content if present
        if reply_to := data.get("reply_to"):
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
            update_data["reply_to"] = reply_to

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
    data: dict, user_id: str, room_id: str
) -> None:
    """
    Handle message deletion with connection pooling.
    
    Args:
        data: The message delete data (message_id)
        user_id: The ID of the user deleting the message
        room_id: The ID of the room containing the message
    """
    message_id = data.get("message_id")
    
    if not message_id:
        return

    database = await db.db
    message = await database.messages.find_one({"_id": ObjectId(message_id)})
    if not message or str(message["user_id"]) != user_id:
        return

    await database.messages.delete_one({"_id": ObjectId(message_id)})
    await manager.broadcast(
        {"type": "message_deleted", "message_id": message_id}, room_id
    )


async def handle_read_receipt(
    user_id: str, room_id: str, message_ids: List[str]
) -> dict:
    """
    Handle marking messages as read with optimized performance.
    
    Args:
        user_id: The ID of the user marking messages as read
        room_id: The ID of the room containing the messages
        message_ids: The IDs of the messages to mark as read
        
    Returns:
        Dictionary with update results
    """
    if not message_ids:
        return {"updated": 0}  # Early return if no messages to update

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
        print(f"Error handling read receipt: {str(e)}")
        # Return error without raising exception to avoid crashing the connection
        return {"error": "Failed to update read status"}


async def process_reply_content(
    reply_to: dict, room_id: str
) -> Optional[dict]:
    """
    Process reply content with connection pooling.
    
    Args:
        reply_to: The reply data to process
        room_id: The ID of the room for decryption
        
    Returns:
        Processed reply data or None if invalid
    """
    if not reply_to:
        return None

    try:
        # Get message_id from either message_id or id field
        message_id = reply_to.get("message_id") or reply_to.get("id")
        if not message_id:
            raise ValueError("Missing message ID in reply_to data")

        # Decrypt reply content if necessary
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
        # Return a basic error structure to maintain consistency
        return {
            "message_id": message_id if "message_id" in locals() else None,
            "content": "Error processing reply content",
            "username": reply_to.get("username", "Unknown"),
        }


async def handle_new_message(
    data: dict, user: dict, room: dict, room_id: str
) -> Optional[dict]:
    """
    Handle new messages with compression, encryption, and push notifications.
    
    Args:
        data: The message data
        user: The user sending the message
        room: The room the message is being sent to
        room_id: The ID of the room
        
    Returns:
        The broadcast message or None if there was an error
    """
    database = await db.db
    reply_content = None

    try:
        if 'content' not in data:
            raise ValueError("Message content is required")

        message_type = data.get("message_type", "text")

        # Process reply_to data if present
        if data.get("reply_to"):
            # Ensure reply_to has consistent message ID field
            reply_to_data = data["reply_to"]
            if "id" in reply_to_data and "message_id" not in reply_to_data:
                reply_to_data["message_id"] = reply_to_data["id"]

        # Separate variable for content to avoid modifying the original
        content_to_store = data["content"]
        
        # Don't compress images or very short messages
        is_compressed = False
        if message_type == "text" and len(content_to_store) >= 100:
            compressed_content, is_compressed = message_compression.compress_message(
                content_to_store
            )
            content_to_store = compressed_content

        # Process based on message type
        if message_type == "image":
            encrypted_content = content_to_store
            nonce = None
            encrypted = False

            # Process reply separately if needed
            if data.get("reply_to"):
                reply_content = await process_reply_content(data.get("reply_to"), room_id)
        else:
            # For text messages, handle encryption and reply processing concurrently
            tasks = []

            if content_to_store:
                tasks.append(
                    asyncio.to_thread(
                        message_encryption.encrypt_message,
                        content_to_store,
                        room_id,
                    )
                )

            if data.get("reply_to"):
                tasks.append(
                    process_reply_content(data.get("reply_to"), room_id)
                )

            # Execute tasks concurrently
            results = await asyncio.gather(*tasks)

            # Unpack results based on which tasks were executed
            if len(tasks) == 2:
                (encrypted_content, nonce), reply_content = results
            elif data.get("reply_to"):
                reply_content = results[0]
                encrypted_content, nonce = None, None
            else:
                encrypted_content, nonce = results[0]

            encrypted = True

        # Create the message document
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
            "reply_to": data.get("reply_to"),
            "read_by": [str(user["_id"])],
        }

        # Use write concern for optimized performance
        write_concern = WriteConcern(w=1, j=False)
        coll = database.get_collection('messages', write_concern=write_concern)

        result = await coll.insert_one(message)
        message["_id"] = result.inserted_id

        # Process content for broadcasting
        if message_type == "image":
            decrypted_content = encrypted_content
        else:
            decrypted_content = ""
            if encrypted_content:
                decrypted_content = await asyncio.to_thread(
                    message_encryption.decrypt_message,
                    encrypted_content,
                    nonce,
                    room_id,
                )

                # Decompress after decryption if needed
                if is_compressed:
                    decrypted_content = message_compression.decompress_message(
                        decrypted_content, True
                    )

        # Create broadcast message
        broadcast_message = {
            "type": "message",
            "message_type": message_type,
            "id": str(message["_id"]),
            "temp_id": data.get("temp_id"),
            "content": decrypted_content,
            "username": message["username"],
            "timestamp": message["timestamp"].isoformat(),
            "room_id": room_id,
            "room_name": room["name"],
            "reply_to": reply_content,
            "read_by": message["read_by"],
        }

        # Create broadcast task to avoid blocking
        asyncio.create_task(manager.broadcast(broadcast_message, room_id))

        # Import here to avoid circular dependency
        from ChatApp.push_notif_service import send_message_notifications

        # Create notification task to avoid blocking
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
        return None


async def handle_disconnect(user_id: str, room_id: str) -> None:
    """
    Optimized disconnect handler
    
    Args:
        user_id: The ID of the user disconnecting
        room_id: The ID of the room the user was in
    """
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


@websocket_router.websocket("/ws/{token}/{room_id}")
async def websocket_endpoint(websocket: WebSocket, token: str, room_id: str):
    """
    WebSocket endpoint with Firebase token verification.
    
    Args:
        websocket: The WebSocket connection
        token: The Firebase authentication token
        room_id: The ID of the room to connect to
    """
    user_id = None
    user = None
    room = None

    # Accept connection first to prevent "need to call accept first" error
    await websocket.accept()

    try:
        # Verify Firebase token
        try:
            # Decode the Firebase ID token
            decoded_token = firebase_auth.verify_id_token(token)
            firebase_uid = decoded_token["uid"]

            # Get database connection
            database = await db.db

            # Fetch user and room data concurrently
            user, room = await asyncio.gather(
                database.users.find_one({"firebase_uid": firebase_uid}),
                database.rooms.find_one({"_id": ObjectId(room_id)}),
            )

            if not user or not room:
                print(f"User or room not found. User: {user}, Room: {room}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            user_id = str(user["_id"])

            # Register with the ConnectionManager
            await manager.connect(websocket, user_id, room_id)

        except firebase_auth.InvalidIdTokenError as e:
            print(f"Invalid Firebase token: {str(e)}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Create message handler mapping - more efficient than if/else chains
        handlers: Dict[str, MessageHandler] = {
            "typing_status": lambda data: handle_typing_status(data, user, room_id),
            "add_emoji_reaction": lambda data: handle_emoji_reaction(data, user, room_id),
            "edit_message": lambda data: handle_message_edit(data, user_id, room_id),
            "delete_message": lambda data: handle_message_delete(data, user_id, room_id),
            "read_receipt": lambda data: handle_read_receipt(
                user_id, room_id, data.get("message_ids", [])
            ),
            "presence_update": lambda data: handle_presence_update(data, user_id, room_id),
            "message": lambda data: handle_new_message(data, user, room, room_id),
        }

        # Message handling loop
        while True:
            data = await websocket.receive_text()

            # Fast path for ping messages
            if data == "ping":
                await handle_presence_ping(user_id, room_id)
                continue

            try:
                # Parse JSON only once
                message_data = json.loads(data)
                message_type = message_data.get("type")

                # Handle message using appropriate handler from mapping
                if handler := handlers.get(message_type):
                    # Process message in a way that allows concurrent message handling
                    if message_type == "message":
                        # Important messages are processed in background tasks
                        asyncio.create_task(handler(message_data))
                    else:
                        # Process other messages directly
                        await handler(message_data)
                else:
                    print(f"Unhandled message type: {message_type}")

            except json.JSONDecodeError:
                # Ignore invalid JSON
                continue
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                continue

    except WebSocketDisconnect:
        if user_id:
            await handle_disconnect(user_id, room_id)
    except Exception as e:
        print(f"Websocket error: {str(e)}")
        if user_id:
            await handle_disconnect(user_id, room_id)