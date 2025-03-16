import asyncio
import json
from datetime import datetime
from typing import List

import pymongo
from bson import ObjectId
from bson.errors import InvalidId
from firebase_admin import auth as firebase_auth
from pymongo import UpdateOne, WriteConcern
from starlette import status
from starlette.websockets import WebSocket, WebSocketDisconnect

from ChatApp.main import logger, message_compression, app, db, manager, message_encryption
from ChatApp.push_notif_service import send_message_notifications


async def handle_presence_ping(manager, user_id: str, room_id: str):
    """Handle presence ping with connection pooling."""
    await manager.update_presence(user_id, room_id, "active")


async def handle_presence_update(manager, data: dict, user_id: str, room_id: str):
    """Handle presence update with connection pooling."""
    status = data.get("status")

    # Handle the timestamp properly - extract from last_active string if timestamp not provided
    if timestamp := data.get("timestamp"):
        last_active = datetime.fromtimestamp(timestamp / 1000)
    elif last_active_str := data.get("last_active"):
        try:
            # Parse ISO format string to datetime
            last_active = datetime.fromisoformat(last_active_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            # Fallback to current time if parsing fails
            last_active = datetime.utcnow()
    else:
        # Use current time if no timestamp data available
        last_active = datetime.utcnow()

    # Update presence directly with the ConnectionManager
    await manager.update_presence(user_id, room_id, status, last_active)


async def handle_typing_status(manager, message_data: dict, user: dict, room_id: str):
    """Handle typing status with connection pooling."""
    typing_status = {
        "type": "typing_status",
        "username": user["username"],
        "is_typing": message_data.get("is_typing", False),
    }
    await manager.broadcast(typing_status, room_id)


async def handle_emoji_reaction(
        manager, db, message_data: dict, user: dict, room_id: str
):
    """Handle emoji reactions with connection pooling."""
    message_id = message_data.get("message_id")
    emoji = message_data.get("emoji")

    async with db.get_client() as client:
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
        manager,
        db,
        message_data: dict,
        user_id: str,
        room_id: str,
        message_encryption,
):
    """Handle message editing with connection pooling."""
    message_id = message_data.get("message_id")
    new_content = message_data.get("content")

    database = await db.db  # Added await
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

        if reply_to := message_data.get("reply_to"):
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
        manager, db, message_data: dict, user_id: str, room_id: str
):
    """Handle message deletion with connection pooling."""
    message_id = message_data.get("message_id")

    database = await db.db  # Added await
    message = await database.messages.find_one({"_id": ObjectId(message_id)})
    if not message or str(message["user_id"]) != user_id:
        return

    await database.messages.delete_one({"_id": ObjectId(message_id)})
    await manager.broadcast(
        {"type": "message_deleted", "message_id": message_id}, room_id
    )


async def handle_read_receipt(
        manager, db, user_id: str, room_id: str, message_ids: List[str]
):
    """Handle marking messages as read with optimized performance."""
    if not message_ids:
        return  # Early return if no messages to update

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
        logger.error(f"Error handling read receipt: {str(e)}")
        # Return error without raising exception to avoid crashing the connection
        return {"error": "Failed to update read status"}


async def process_reply_content(reply_to, message_encryption, room_id):
    """Process reply content with connection pooling."""
    if not reply_to:
        return None

    try:
        # Get message_id from either message_id or id field
        message_id = reply_to.get("message_id") or reply_to.get("id")
        if not message_id:
            raise ValueError("Missing message ID in reply_to data")

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
        return {
            "message_id": message_id if "message_id" in locals() else None,
            "content": "Error processing reply content",
            "username": reply_to.get("username", "Unknown"),
        }


async def handle_new_message(
        manager,
        db,
        message_data: dict,
        user: dict,
        room: dict,
        room_id: str,
        message_encryption,
):
    """Handle new messages with compression, encryption, and push notifications."""
    database = await db.db
    reply_content = None

    try:
        if 'content' not in message_data:
            raise ValueError("Message content is required")

        message_type = message_data.get("message_type", "text")

        # Process reply_to data if present
        if message_data.get("reply_to"):
            # Ensure reply_to has consistent message ID field
            reply_to_data = message_data["reply_to"]
            if "id" in reply_to_data and "message_id" not in reply_to_data:
                reply_to_data["message_id"] = reply_to_data["id"]

        # Don't compress images or very short messages
        if message_type == "text" and len(message_data["content"]) >= 100:
            compressed_content, is_compressed = message_compression.compress_message(
                message_data["content"]
            )
            message_data["content"] = compressed_content
        else:
            is_compressed = False

        # Existing encryption logic
        if message_type == "image":
            encrypted_content = message_data["content"]
            nonce = None
            encrypted = False

            if message_data.get("reply_to"):
                reply_content = await process_reply_content(
                    message_data.get("reply_to"), message_encryption, room_id
                )
        else:
            tasks = []

            if message_data["content"]:
                tasks.append(
                    asyncio.to_thread(
                        message_encryption.encrypt_message,
                        message_data["content"],
                        room_id,
                    )
                )

            if message_data.get("reply_to"):
                tasks.append(
                    process_reply_content(
                        message_data.get("reply_to"), message_encryption, room_id
                    )
                )

            results = await asyncio.gather(*tasks)

            if len(tasks) == 2:
                content, reply_content = results
            elif message_data.get("reply_to"):
                reply_content = results[0]
                content = (None, None)
            else:
                content = results[0]

            encrypted_content, nonce = content
            encrypted = True

        # Add compression flag to message document
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
            "reply_to": message_data.get("reply_to"),
            "read_by": [str(user["_id"])],
        }

        write_concern = WriteConcern(w=1, j=False)
        coll = database.get_collection('messages', write_concern=write_concern)

        result = await coll.insert_one(message)
        message["_id"] = result.inserted_id

        if message_type == "image":
            decrypted_content = encrypted_content
        else:
            decrypted_content = await asyncio.to_thread(
                message_encryption.decrypt_message,
                encrypted_content,
                nonce,
                room_id,
            ) if encrypted_content else ""

            # Decompress after decryption if needed
            if is_compressed:
                decrypted_content = message_compression.decompress_message(
                    decrypted_content, True
                )

        broadcast_message = {
            "type": "message",
            "message_type": message_type,
            "id": str(message["_id"]),
            "temp_id": message_data.get("temp_id"),
            "content": decrypted_content,
            "username": message["username"],
            "timestamp": message["timestamp"].isoformat(),
            "room_id": room_id,
            "room_name": room["name"],
            "reply_to": reply_content,
            "read_by": message["read_by"],
        }

        asyncio.create_task(manager.broadcast(broadcast_message, room_id))

        # Send push notifications to users in the room who are not the sender
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
        raise


@app.websocket("/ws/{token}/{room_id}")
async def websocket_endpoint(websocket: WebSocket, token: str, room_id: str):
    """WebSocket endpoint with Firebase token verification."""
    user_id = None

    # Accept connection first to prevent "need to call accept first" error
    await websocket.accept()

    # Create handler mapping outside the loop for better performance
    handlers = None

    try:
        # Now verify Firebase token
        try:
            # Decode the Firebase ID token
            decoded_token = firebase_auth.verify_id_token(token)
            firebase_uid = decoded_token["uid"]

            # Get database connection
            database = await db.db

            # Concurrent fetch of user and room data
            user, room = await asyncio.gather(
                database.users.find_one({"firebase_uid": firebase_uid}),
                database.rooms.find_one({"_id": ObjectId(room_id)}),
            )

            if not user or not room:
                print(f"User or room not found. User: {user}, Room: {room}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            user_id = str(user["_id"])

            # Now register with the ConnectionManager
            await manager.connect(websocket, user_id, room_id)

        except firebase_auth.InvalidIdTokenError as e:
            print(f"Invalid Firebase token: {str(e)}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Create handlers mapping once - better performance than recreating each loop
        handlers = {
            "typing_status": lambda data: handle_typing_status(
                manager, data, user, room_id
            ),
            "add_emoji_reaction": lambda data: handle_emoji_reaction(
                manager, db, data, user, room_id
            ),
            "edit_message": lambda data: handle_message_edit(
                manager, db, data, user_id, room_id, message_encryption
            ),
            "delete_message": lambda data: handle_message_delete(
                manager, db, data, user_id, room_id
            ),
            "read_receipt": lambda data: handle_read_receipt(
                manager, db, user_id, room_id, data.get("message_ids", [])
            ),
            "presence_update": lambda data: handle_presence_update(
                manager, data, user_id, room_id
            ),
        }

        # Message handling loop
        while True:
            data = await websocket.receive_text()

            # Fast path for ping messages
            if data == "ping":
                await handle_presence_ping(manager, user_id, room_id)
                continue

            try:
                # Parse JSON only once
                message_data = json.loads(data)
                message_type = message_data.get("type")

                # Handle special message types efficiently
                if message_type in handlers:
                    await handlers[message_type](message_data)
                    continue

                # Process regular messages
                if message_type == "message":
                    # Fast validation check
                    if "content" not in message_data:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Message missing required 'content' field",
                            }
                        )
                        continue

                    # Process message in a way that allows concurrent message handling
                    asyncio.create_task(
                        handle_new_message(
                            manager,
                            db,
                            message_data,
                            user,
                            room,
                            room_id,
                            message_encryption,
                        )
                    )
                else:
                    print(f"Unhandled message type: {message_type}")

            except json.JSONDecodeError:
                # Fast error path - don't do expensive processing
                continue
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                continue

    except WebSocketDisconnect:
        if user_id:
            await handle_disconnect(manager, user_id, room_id)
    except Exception as e:
        print(f"Websocket error: {str(e)}")
        if user_id:
            await handle_disconnect(manager, user_id, room_id)


async def handle_disconnect(manager, user_id: str, room_id: str):
    """Optimized disconnect handler"""
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
