# Standard library imports
import re
from datetime import datetime
from typing import List

# Third-party imports
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from ChatApp.dependencies import db
# Local imports
from ChatApp.models import RoomInviteCreate, RoomInvite, RoomInviteResponse, InviteActionResponse, RoomMember
from ChatApp.rooms_service import get_room_by_id, get_user_by_id, get_invite_by_id, check_room_membership, \
    check_existing_invite
from ChatApp.user import get_current_user

# Create the router
invite_router = APIRouter(tags=["invites"])


@invite_router.get("/users/search", response_model=List[dict])
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    """Search for users by username or email."""
    # Skip empty queries
    if not q or len(q.strip()) < 2:
        return []

    database = await db.db
    query_term = q.strip().lower()

    # Create a case-insensitive regex pattern for the search
    pattern = re.compile(f".*{re.escape(query_term)}.*", re.IGNORECASE)

    # Search for users by username or email
    users_cursor = database.users.find({
        "$or": [
            {"username": {"$regex": pattern}},
            {"email": {"$regex": pattern}}
        ]
    })

    # Limit to reasonable number of results
    users = await users_cursor.to_list(length=20)

    # Format results to match frontend expectations
    results = []
    for user in users:
        # Don't include the current user in search results
        if str(user["_id"]) == str(current_user["_id"]):
            continue

        results.append({
            "id": str(user["_id"]),
            "username": user["username"],
            "email": user["email"]
        })

    return results


@invite_router.post("/room/invite", response_model=dict)
async def invite_user_to_room(invite: RoomInviteCreate, current_user: dict = Depends(get_current_user)):
    """Invite a user to a room."""
    database = await db.db
    user_id = str(current_user["_id"])
    print(f"Received invite request: {invite}")
    print(f"Model validation format expected: {RoomInviteCreate.schema_json(indent=2)}")

    # Validate room exists
    room = await get_room_by_id(invite.room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Check if current user is a member
    is_member = await check_room_membership(user_id, invite.room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to invite users to this room")

    # Validate target user exists
    target_user = await get_user_by_id(invite.userId)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if user is already a member
    is_already_member = await check_room_membership(invite.userId, invite.room_id)
    if is_already_member:
        raise HTTPException(status_code=400, detail="User is already a member of this room")

    # Check if there's already a pending invite
    has_invite = await check_existing_invite(invite.userId, invite.room_id)
    if has_invite:
        raise HTTPException(status_code=400, detail="User already has a pending invite to this room")

    # Create the invite
    invite_data = RoomInvite(
        room_id=invite.room_id,
        user_id=invite.userId,
        invited_by=current_user["email"]
    )

    result = await database.room_invites.insert_one(invite_data.model_dump())

    return {
        "success": True,
        "message": f"Invite sent to {target_user['username']}",
        "inviteId": str(result.inserted_id)
    }


@invite_router.get("/invites/pending", response_model=List[RoomInviteResponse])
async def get_pending_invites(current_user: dict = Depends(get_current_user)):
    """Get all pending invites for the current user."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Find all pending invites for the user
    invites_cursor = database.room_invites.find({
        "user_id": user_id,
        "status": "pending"
    })

    invites = await invites_cursor.to_list(length=100)

    # If no invites, return empty list
    if not invites:
        return []

    # Get room details for each invite
    result = []
    for invite in invites:
        room = await get_room_by_id(invite["room_id"])
        if not room:
            continue

        # Get inviter username
        inviter = await database.users.find_one({"email": invite["invited_by"]})
        inviter_name = inviter["username"] if inviter else "Unknown"

        result.append(RoomInviteResponse(
            id=str(invite["_id"]),
            room_id=invite["room_id"],
            room_name=room["name"],
            invited_by=invite["invited_by"],
            invitedBy=inviter_name,
            userId=invite["user_id"],
            username=current_user["username"],
            status=invite["status"],
            created_at=invite["created_at"]
        ))

    return result


@invite_router.get("/rooms/{room_id}/invites", response_model=List[RoomInviteResponse])
async def get_room_invites(room_id: str, current_user: dict = Depends(get_current_user)):
    """Get all pending invites for a specific room."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Verify the user is a member of the room
    is_member = await check_room_membership(user_id, room_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not authorized to view room invites")

    # Find all pending invites for the room
    invites_cursor = database.room_invites.find({
        "room_id": room_id,
        "status": "pending"
    })

    invites = await invites_cursor.to_list(length=100)

    # Get user details for each invite
    result = []
    for invite in invites:
        user = await get_user_by_id(invite["user_id"])
        if not user:
            continue

        result.append(RoomInviteResponse(
            id=str(invite["_id"]),
            room_id=invite["room_id"],
            room_name="",  # Not needed in this context
            invited_by=invite["invited_by"],
            invitedBy="",  # Not needed in this context
            userId=invite["user_id"],
            username=user["username"],
            status=invite["status"],
            created_at=invite["created_at"]
        ))

    return result


@invite_router.post("/invites/{invite_id}/accept", response_model=InviteActionResponse)
async def accept_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Accept a room invitation."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Get the invite
    invite = await get_invite_by_id(invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")

    # Verify the invite belongs to the current user
    if invite["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to accept this invite")

    # Verify the invite is still pending
    if invite["status"] != "pending":
        raise HTTPException(status_code=400, detail="Invite is no longer pending")

    # Get the room
    room = await get_room_by_id(invite["room_id"])
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Update the invite status
    await database.room_invites.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "accepted"}}
    )

    # Check if user is already a member (edge case)
    is_member = await check_room_membership(user_id, invite["room_id"])
    if not is_member:
        # Add user to room members
        new_member = RoomMember(
            user_id=user_id,
            username=current_user["username"],
            email=current_user["email"],
            joined_at=datetime.utcnow()
        )

        await database.rooms.update_one(
            {"_id": ObjectId(invite["room_id"])},
            {"$push": {"members": new_member.model_dump()}}
        )

    # Create initial read receipt if it doesn't exist
    read_receipt = await database.read_receipts.find_one({
        "user_id": user_id,
        "room_id": invite["room_id"]
    })

    if not read_receipt:
        await database.read_receipts.insert_one({
            "user_id": user_id,
            "room_id": invite["room_id"],
            "timestamp": datetime.utcnow()
        })

    return InviteActionResponse(
        success=True,
        roomId=invite["room_id"],
        message=f"Successfully joined {room['name']}"
    )


@invite_router.post("/invites/{invite_id}/decline", response_model=InviteActionResponse)
async def decline_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Decline a room invitation."""
    database = await db.db
    user_id = str(current_user["_id"])

    # Get the invite
    invite = await get_invite_by_id(invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")

    # Verify the invite belongs to the current user
    if invite["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to decline this invite")

    # Verify the invite is still pending
    if invite["status"] != "pending":
        raise HTTPException(status_code=400, detail="Invite is no longer pending")

    # Update the invite status
    await database.room_invites.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "declined"}}
    )

    return InviteActionResponse(
        success=True,
        roomId=invite["room_id"],
        message="Invitation declined"
    )
