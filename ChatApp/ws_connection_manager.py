import asyncio
import json
import time
from collections import defaultdict
from datetime import datetime
from typing import Dict, Set, Any, Optional, List, NamedTuple

from starlette.websockets import WebSocket


class UserConnection(NamedTuple):
    """Represents a user's connection state in a room"""
    user_id: str
    status: str
    last_active: datetime
    connections: Set[WebSocket]


class ConnectionManager:
    def __init__(self):
        # Main data structure: room_id -> {user_id -> UserConnection}
        self.rooms: Dict[str, Dict[str, UserConnection]] = defaultdict(dict)
        
        # Track user's current room for quick lookups
        self.user_room_map: Dict[str, str] = {}
        
        # Presence cache with TTL
        self.presence_cache: Dict[str, Dict[str, Any]] = {}
        self.presence_cache_ttl = 2  # seconds
        
        # Special "unassigned" room for connections not yet in a room
        self.UNASSIGNED = "unassigned"

    async def connect(
            self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None
    ):
        """Connect a websocket with optional room assignment"""
        target_room = room_id or self.UNASSIGNED
        
        # Initialize or update the user connection
        if user_id in self.rooms[target_room]:
            # User exists in room, add this connection
            user_conn = self.rooms[target_room][user_id]
            connections = user_conn.connections | {websocket}  # Add new connection
            
            # Update with new connection set
            self.rooms[target_room][user_id] = UserConnection(
                user_id=user_id,
                status="active",
                last_active=datetime.utcnow(),
                connections=connections
            )
        else:
            # New user in room
            self.rooms[target_room][user_id] = UserConnection(
                user_id=user_id,
                status="active",
                last_active=datetime.utcnow(),
                connections={websocket}
            )
        
        # Update user's room mapping if in a real room
        if room_id:
            self.user_room_map[user_id] = room_id
            # Broadcast presence update
            self._invalidate_presence_cache(room_id)
            await self.broadcast_presence(room_id)

    async def switch_room(self, websocket: WebSocket, user_id: str, new_room_id: str):
        """Switch a websocket connection to a new room"""
        try:
            old_room_id = self.user_room_map.get(user_id, self.UNASSIGNED)
            
            # Skip if already in the target room
            if old_room_id == new_room_id:
                return
                
            # Handle old room
            if user_id in self.rooms[old_room_id]:
                user_conn = self.rooms[old_room_id][user_id]
                
                # Remove the connection from old room
                if websocket in user_conn.connections:
                    remaining_connections = user_conn.connections - {websocket}
                    
                    if remaining_connections:
                        # Update with remaining connections
                        self.rooms[old_room_id][user_id] = UserConnection(
                            user_id=user_id,
                            status=user_conn.status,
                            last_active=user_conn.last_active,
                            connections=remaining_connections
                        )
                    else:
                        # No connections left, remove user from room
                        del self.rooms[old_room_id][user_id]
                        
                        # Clean up empty room
                        if not self.rooms[old_room_id] and old_room_id != self.UNASSIGNED:
                            del self.rooms[old_room_id]
                    
                    # Only broadcast presence update for real rooms
                    if old_room_id != self.UNASSIGNED:
                        self._invalidate_presence_cache(old_room_id)
                        await self.broadcast_presence(old_room_id)
            
            # Handle new room
            # Initialize or update user in new room
            if user_id in self.rooms[new_room_id]:
                user_conn = self.rooms[new_room_id][user_id]
                connections = user_conn.connections | {websocket}
                
                self.rooms[new_room_id][user_id] = UserConnection(
                    user_id=user_id,
                    status="active",
                    last_active=datetime.utcnow(),
                    connections=connections
                )
            else:
                self.rooms[new_room_id][user_id] = UserConnection(
                    user_id=user_id,
                    status="active",
                    last_active=datetime.utcnow(),
                    connections={websocket}
                )
            
            # Update user's room mapping
            self.user_room_map[user_id] = new_room_id
            
            # Broadcast presence update for new room
            self._invalidate_presence_cache(new_room_id)
            await self.broadcast_presence(new_room_id)
            
        except Exception as e:
            print(f"Error in room switch: {str(e)}")
            raise

    async def disconnect(self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None):
        """Handle disconnection with optional room ID"""
        try:
            # Get actual room_id from user_room_map if not provided
            actual_room_id = room_id or self.user_room_map.get(user_id, self.UNASSIGNED)
            
            if user_id in self.rooms[actual_room_id]:
                user_conn = self.rooms[actual_room_id][user_id]
                
                if websocket in user_conn.connections:
                    remaining_connections = user_conn.connections - {websocket}
                    
                    if remaining_connections:
                        # User still has other connections in the room
                        self.rooms[actual_room_id][user_id] = UserConnection(
                            user_id=user_id,
                            status=user_conn.status,
                            last_active=user_conn.last_active,
                            connections=remaining_connections
                        )
                    else:
                        # No connections left, remove user from room
                        del self.rooms[actual_room_id][user_id]
                        
                        # Remove from user_room_map if this was their tracked room
                        if self.user_room_map.get(user_id) == actual_room_id:
                            del self.user_room_map[user_id]
                        
                        # Clean up empty room
                        if not self.rooms[actual_room_id] and actual_room_id != self.UNASSIGNED:
                            del self.rooms[actual_room_id]
                    
                    # Only broadcast presence for real rooms
                    if actual_room_id != self.UNASSIGNED:
                        self._invalidate_presence_cache(actual_room_id)
                        await self.broadcast_presence(actual_room_id)
        
        except Exception as e:
            print(f"Error in disconnect handling: {str(e)}")

    async def broadcast(
            self,
            message: dict,
            room_id: str,
            exclude_user_id: Optional[str] = None,
    ):
        """Broadcast message to all connections in a room"""
        if room_id not in self.rooms:
            return  # No connections in this room
            
        message_json = json.dumps(message)
        conn_tasks = []

        for user_id, user_conn in self.rooms[room_id].items():
            if user_id != exclude_user_id and user_conn.connections:
                conn_tasks.extend(
                    [conn.send_text(message_json) for conn in user_conn.connections]
                )

        if conn_tasks:
            await asyncio.gather(*conn_tasks, return_exceptions=True)

    def _invalidate_presence_cache(self, room_id: str):
        """Invalidate presence cache for a room"""
        if room_id in self.presence_cache:
            del self.presence_cache[room_id]

    async def update_presence(
            self, user_id: str, room_id: str, status: str, last_active: Optional[datetime] = None
    ):
        """Update a user's presence status"""
        if room_id not in self.rooms or user_id not in self.rooms[room_id]:
            return  # User not in this room
            
        user_conn = self.rooms[room_id][user_id]
        timestamp = last_active or datetime.utcnow()
        
        # Update user connection with new status
        self.rooms[room_id][user_id] = UserConnection(
            user_id=user_id,
            status=status,
            last_active=timestamp,
            connections=user_conn.connections
        )

        self._invalidate_presence_cache(room_id)
        await self.broadcast_presence(room_id)

    async def broadcast_presence(self, room_id: str):
        """Broadcast presence information to all users in a room"""
        if room_id not in self.rooms:
            return  # No connections in this room
            
        current_time = time.time()
        cache_entry = self.presence_cache.get(room_id)
        
        if (
                cache_entry
                and current_time - cache_entry["timestamp"] < self.presence_cache_ttl
        ):
            presence_message = cache_entry["message"]
        else:
            # Format presence data for broadcasting
            presence_data = {
                user_id: {
                    "status": user_conn.status,
                    "last_active": user_conn.last_active.isoformat(),
                }
                for user_id, user_conn in self.rooms[room_id].items()
            }
            
            presence_message = {
                "type": "presence",
                "presence": presence_data,
            }
            
            self.presence_cache[room_id] = {
                "message": presence_message,
                "timestamp": current_time,
            }

        await self.broadcast(presence_message, room_id)

    def get_active_users(self, room_id: str) -> List[str]:
        """Get list of active users in a room"""
        if room_id not in self.rooms:
            return []
            
        return [
            user_id 
            for user_id, user_conn in self.rooms[room_id].items()
            if user_conn.status == "active"
        ]