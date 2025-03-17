import random
import string
from datetime import datetime
from typing import Optional, List

import pymongo
from bson import ObjectId
from fastapi import Depends, HTTPException, APIRouter

from ChatApp.dependencies import db
from ChatApp.models import RoomResponse, RoomCreate, RoomMember, RoomJoin
from ChatApp.user import get_current_user

# Create a router
rooms_router = APIRouter(tags=["rooms"])


async def generate_room_code() -> str:
    """Generate unique room code."""
    db_instance = await db.db
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        existing_room = await db_instance.rooms.find_one({"code": code})
        if not existing_room:
            return code


async def get_room_by_code(code: str) -> Optional[dict]:
    """Get room by code."""
    database = await db.db
    return await database.rooms.find_one({"code": code})


async def get_room_by_id(room_id: str) -> Optional[dict]:
    """Get room by ID."""
    try:
        database = await db.db
        return await database.rooms.find_one({"_id": ObjectId(room_id)})
    except pymongo.errors.PyMongoError:
        return None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    """Get user by ID."""
    try:
        database = await db.db
        return await database.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return None


async def get_invite_by_id(invite_id: str) -> Optional[dict]:
    """Get invite by ID."""
    try:
        database = await db.db
        return await database.room_invites.find_one({"_id": ObjectId(invite_id)})
    except Exception:
        return None


async def check_room_membership(user_id: str, room_id: str) -> bool:
    """Check if a user is a member of a room."""
    database = await db.db

    print(f"DEBUG - Checking membership: user_id={user_id}, room_id={room_id}")

    # Find room and check if user is in members array
    room = await database.rooms.find_one({
        "_id": ObjectId(room_id),
        "members.user_id": user_id
    })

    is_member = room is not None
    print(f"DEBUG - Membership check result: {is_member}")

    return is_member


async def check_existing_invite(user_id: str, room_id: str) -> bool:
    """Check if there's already a pending invite for this user and room."""
    database = await db.db
    invite = await database.room_invites.find_one({
        "user_id": user_id,
        "room_id": room_id,
        "status": "pending"
    })
    return invite is not None


@rooms_router.post("/rooms", response_model=RoomResponse)
async def create_room(room: RoomCreate, current_user: dict = Depends(get_current_user)):
    """Create new chat room with creator as first member."""
    code = await generate_room_code()
    user_id = str(current_user["_id"])

    # Create initial member record for creator
    creator_member = RoomMember(
        user_id=user_id,
        username=current_user["username"],
        email=current_user["email"],
        joined_at=datetime.utcnow()
    )

    room_dict = {
        "name": room.name,
        "code": code,
        "created_by": current_user["email"],
        "created_at": datetime.utcnow(),
        "members": [creator_member.model_dump()]
    }

    database = await db.db
    result = await database.rooms.insert_one(room_dict)

    # Create initial read receipt
    await database.read_receipts.insert_one({
        "user_id": user_id,
        "room_id": str(result.inserted_id),
        "timestamp": datetime.utcnow()
    })

    response_dict = {
        "id": str(result.inserted_id),
        "name": room.name,
        "code": code,
        "created_by": current_user["email"],
        "created_at": room_dict["created_at"],
        "members": [current_user["username"]],
        "is_owner": True,
        "unread_count": 0
    }

    return RoomResponse(**response_dict)


@rooms_router.post("/rooms/join", response_model=RoomResponse)
async def join_room(room_join: RoomJoin, current_user: dict = Depends(get_current_user)):
    """Join existing room by code."""
    database = await db.db
    room = await get_room_by_code(room_join.code)

    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    user_id = str(current_user["_id"])
    room_id = str(room["_id"])

    # Check if user is already a member
    is_member = await check_room_membership(user_id, room_id)
    if is_member:
        # User is already a member, just return the room
        pass
    else:
        # Add user to room members
        new_member = RoomMember(
            user_id=user_id,
            username=current_user["username"],
            email=current_user["email"],
            joined_at=datetime.utcnow()
        )

        await database.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$push": {"members": new_member.model_dump()}}
        )

        # Create initial read receipt
        await database.read_receipts.insert_one({
            "user_id": user_id,
            "room_id": room_id,
            "timestamp": datetime.utcnow()
        })

    # Get unread count for this room
    last_read = await database.read_receipts.find_one(
        {"user_id": user_id, "room_id": room_id}
    )
    last_read_time = last_read["timestamp"] if last_read else datetime.min

    unread_count = await database.messages.count_documents({
        "room_id": room_id,
        "timestamp": {"$gt": last_read_time},
        "username": {"$ne": current_user["username"]}
    })

    # Get updated room with new member
    updated_room = await get_room_by_id(room_id)

    # Extract usernames for response
    member_usernames = [member["username"] for member in updated_room.get("members", [])]

    return RoomResponse(
        id=room_id,
        name=room["name"],
        code=room["code"],
        created_by=room["created_by"],
        created_at=room["created_at"],
        members=member_usernames,
        is_owner=room["created_by"] == current_user["email"],
        unread_count=unread_count
    )


@rooms_router.get("/rooms", response_model=List[RoomResponse])
async def get_user_rooms(current_user: dict = Depends(get_current_user)):
    """Get rooms where user is a member."""
    user_id = str(current_user["_id"])
    user_email = current_user["email"]
    database = await db.db

    # Find all rooms where user is a member
    rooms_cursor = database.rooms.find({
        "members.user_id": user_id
    })

    rooms = await rooms_cursor.to_list(length=100)
    result = []

    for room in rooms:
        # Get last read timestamp
        last_read = await database.read_receipts.find_one(
            {"user_id": user_id, "room_id": str(room["_id"])}
        )
        last_read_time = last_read["timestamp"] if last_read else datetime.min

        # Get unread count
        unread_count = await database.messages.count_documents({
            "room_id": str(room["_id"]),
            "timestamp": {"$gt": last_read_time},
            "username": {"$ne": current_user["username"]}
        })

        # Extract member usernames
        member_usernames = [member["username"] for member in room.get("members", [])]

        result.append(RoomResponse(
            id=str(room["_id"]),
            name=room["name"],
            code=room["code"],
            created_by=room["created_by"],
            created_at=room["created_at"],
            members=member_usernames,
            is_owner=room["created_by"] == user_email,
            unread_count=unread_count
        ))

    return result


@rooms_router.get("/rooms/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single room by ID."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Get room document
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Check if user is a member
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a member of this room")

    # Get unread count
    last_read = await database.read_receipts.find_one(
        {"user_id": user_id, "room_id": room_id}
    )
    last_read_time = last_read["timestamp"] if last_read else datetime.min

    unread_count = await database.messages.count_documents({
        "room_id": room_id,
        "timestamp": {"$gt": last_read_time},
        "username": {"$ne": current_user["username"]}
    })

    # Extract member usernames
    member_usernames = [member["username"] for member in room.get("members", [])]

    return RoomResponse(
        id=room_id,
        name=room["name"],
        code=room["code"],
        created_by=room["created_by"],
        created_at=room["created_at"],
        members=member_usernames,
        is_owner=room["created_by"] == current_user["email"],
        unread_count=unread_count
    )


@rooms_router.delete("/rooms/{room_id}/leave")
async def leave_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Leave a room (remove user from members)."""
    user_id = str(current_user["_id"])
    database = await db.db

    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Don't allow creator to leave their own room
    if room["created_by"] == current_user["email"]:
        raise HTTPException(
            status_code=400,
            detail="Room creator cannot leave their own room. Delete the room instead."
        )

    # Remove user from members array
    result = await database.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$pull": {"members": {"user_id": user_id}}}
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Not a member of this room")

    # Remove read receipt
    await database.read_receipts.delete_one({
        "user_id": user_id,
        "room_id": room_id
    })

    return {"message": "Successfully left the room"}


@rooms_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, current_user: dict = Depends(get_current_user)):
    """Delete room and its messages."""
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room["created_by"] != current_user["email"]:
        raise HTTPException(
            status_code=403, detail="Only room creator can delete the room"
        )

    database = await db.db

    # Delete room and all related data
    await database.rooms.delete_one({"_id": ObjectId(room_id)})
    await database.messages.delete_many({"room_id": room_id})
    await database.read_receipts.delete_many({"room_id": room_id})
    await database.room_invites.delete_many({"room_id": room_id})

    return {"message": "Room and related data deleted successfully"}


@rooms_router.get("/rooms/{room_id}/members", response_model=List[dict])
async def get_room_members(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get all members of a room."""
    user_id = str(current_user["_id"])
    database = await db.db

    # Check if the user is a member of the room
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to view room members")

    # Get room with members
    room = await get_room_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Extract member details
    members = []
    for member in room.get("members", []):
        members.append({
            "id": member["user_id"],
            "username": member["username"],
            "email": member["email"],
            "joined_at": member["joined_at"]
        })

    return members
