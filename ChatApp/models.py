from datetime import datetime
from typing import Optional, List, Dict

from pydantic import BaseModel, EmailStr, ConfigDict, Field


class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class User(UserBase):
    is_active: bool = True
    profile_photo_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)
    firebase_uid: str


class FriendRequest(BaseModel):
    from_user_id: str
    to_user_id: str
    status: str = "pending"  # pending, accepted, declined
    created_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str


class RecaptchaRequest(BaseModel):
    token: str


class RecaptchaResponse(BaseModel):
    success: bool
    score: Optional[float] = None
    message: Optional[str] = None


class FCMTokenCreate(BaseModel):
    token: str
    device_id: str
    device_type: str  # "android", "ios", "web"


class FCMToken(FCMTokenCreate):
    user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class PushNotification(BaseModel):
    title: str
    body: str
    data: Optional[dict] = None
    image_url: Optional[str] = None
    topic: Optional[str] = None
    token: Optional[str] = None
    user_ids: Optional[List[str]] = None


class TokenData(BaseModel):
    email: Optional[str] = None


class MessageRead(BaseModel):
    message_id: str
    read_by: List[str] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    content: str
    room_id: Optional[str] = None
    encrypted: bool = True
    reply_to: Optional[dict] = None
    message_type: str = "text"  # Add message type field


class MessageResponse(BaseModel):
    id: str
    content: str
    username: str
    timestamp: datetime
    room_id: str
    room_name: Optional[str] = None
    compressed: bool = False
    encrypted: bool = True
    nonce: Optional[str] = None
    reply_to: Optional[dict] = None
    reactions: Optional[Dict[str, List[str]]] = None
    edited: bool = False
    edited_at: Optional[datetime] = None
    read_by: List[str] = Field(default_factory=list)
    message_type: str = "text"  # Add message type field
    model_config = ConfigDict(from_attributes=True)


class UserPresence(BaseModel):
    user_id: str
    room_id: str
    status: str  # "active" or "inactive"
    last_active: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class RoomResponse(BaseModel):
    id: str
    name: str
    code: str
    created_by: str
    created_at: datetime
    members: List[str] = []  # List of user IDs
    is_owner: bool = False
    unread_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class RoomJoin(BaseModel):
    code: str


class RoomMember(BaseModel):
    user_id: str
    username: str
    email: str
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(from_attributes=True)


class RoomInvite(BaseModel):
    room_id: str
    user_id: str
    invited_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "pending"  # pending, accepted, declined
    model_config = ConfigDict(from_attributes=True)


class RoomInviteCreate(BaseModel):
    room_id: str
    userId: str  # Matching the frontend field name


class RoomInviteResponse(BaseModel):
    id: str
    room_id: str
    room_name: str
    invited_by: str
    invitedBy: str  # Added for frontend compatibility
    userId: str
    username: str
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class InviteActionResponse(BaseModel):
    success: bool
    roomId: str
    message: str
