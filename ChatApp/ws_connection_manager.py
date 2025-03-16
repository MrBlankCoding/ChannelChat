import asyncio
import json
import time
from collections import defaultdict
from datetime import datetime
from typing import Dict, Set, Any, Optional, List

from starlette.websockets import WebSocket


class ConnectionManager:
    def __init__(self):
        # Modified to handle connections without room assignment
        self.active_connections: Dict[str, Dict[str, Set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )
        self.user_presence: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        self.connection_count: Dict[str, Dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        # Track user's current room
        self.user_rooms: Dict[str, Optional[str]] = {}
        self.presence_cache = {}
        self.presence_cache_ttl = 2

    async def connect(
            self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None
    ):
        """Connect a websocket with optional room assignment"""
        # Remove this line since connection is already accepted
        # await websocket.accept()

        if room_id:
            self.active_connections[room_id][user_id].add(websocket)
            self.connection_count[room_id][user_id] += 1

            # Initialize presence with proper structure
            self.user_presence[room_id][user_id] = {
                "status": "active",
                "last_active": datetime.utcnow().isoformat(),
            }

            # Clear cache on connection changes
            self._invalidate_presence_cache(room_id)
            await self.broadcast_presence(room_id)
        else:
            # Store connection in a special "unassigned" section
            self.active_connections["unassigned"][user_id].add(websocket)
            self.connection_count["unassigned"][user_id] += 1

        # Track user's current room
        self.user_rooms[user_id] = room_id

    async def switch_room(self, websocket: WebSocket, user_id: str, new_room_id: str):
        """Switch a websocket connection to a new room"""
        try:
            old_room_id = self.user_rooms.get(user_id, "unassigned")

            # Remove from old room or unassigned
            if old_room_id:
                if websocket in self.active_connections[old_room_id][user_id]:
                    self.active_connections[old_room_id][user_id].remove(websocket)
                    self.connection_count[old_room_id][user_id] -= 1

                    if self.connection_count[old_room_id][user_id] <= 0:
                        self.active_connections[old_room_id].pop(user_id, None)
                        self.connection_count[old_room_id].pop(user_id, None)
                        self.user_presence[old_room_id].pop(user_id, None)

                    # Clean up empty old room
                    if not self.active_connections[old_room_id]:
                        self.active_connections.pop(old_room_id, None)
                        self.connection_count.pop(old_room_id, None)
                        self.user_presence.pop(old_room_id, None)
                        self._invalidate_presence_cache(old_room_id)
                    else:
                        await self.broadcast_presence(old_room_id)

                # Add to new room
                self.active_connections[new_room_id][user_id].add(websocket)
                self.connection_count[new_room_id][user_id] += 1

                # Initialize presence in new room
                self.user_presence[new_room_id][user_id] = {
                    "status": "active",
                    "last_active": datetime.utcnow().isoformat(),
                }

                # Update user's current room
                self.user_rooms[user_id] = new_room_id

                # Invalidate cache and broadcast presence for new room
                self._invalidate_presence_cache(new_room_id)
                await self.broadcast_presence(new_room_id)

        except Exception as e:
            print(f"Error in room switch: {str(e)}")
            raise

    async def handle_disconnect(
            self, websocket: WebSocket, user_id: str, room_id: Optional[str] = None
    ):
        """Handle disconnection with optional room ID"""
        try:
            # Get actual room_id from user_rooms if not provided
            actual_room_id = room_id or self.user_rooms.get(user_id, "unassigned")

            if websocket in self.active_connections[actual_room_id][user_id]:
                self.active_connections[actual_room_id][user_id].remove(websocket)
                self.connection_count[actual_room_id][user_id] -= 1

                if self.connection_count[actual_room_id][user_id] <= 0:
                    self.active_connections[actual_room_id].pop(user_id, None)
                    self.connection_count[actual_room_id].pop(user_id, None)

                    # Update presence to offline before removing
                    if user_id in self.user_presence[actual_room_id]:
                        self.user_presence[actual_room_id][user_id][
                            "status"
                        ] = "offline"
                        self._invalidate_presence_cache(actual_room_id)
                        await self.broadcast_presence(actual_room_id)
                        # Then remove from presence tracking
                        self.user_presence[actual_room_id].pop(user_id, None)

                    # Clean up empty rooms
                    if not self.active_connections[actual_room_id]:
                        self.active_connections.pop(actual_room_id, None)
                        self.connection_count.pop(actual_room_id, None)
                        self.user_presence.pop(actual_room_id, None)
                        self._invalidate_presence_cache(actual_room_id)
                    else:
                        await self.broadcast_presence(actual_room_id)

                # Clean up user room tracking
                if user_id in self.user_rooms:
                    del self.user_rooms[user_id]

        except Exception as e:
            print(f"Error in disconnect handling: {str(e)}")

    # Rest of the methods remain the same
    async def broadcast(
            self,
            message: dict,
            room_id: str,
            exclude_user_id: Optional[str] = None,
    ):
        message_json = json.dumps(message)
        conn_tasks = []

        if room_id in self.active_connections:
            for user_id, connections in self.active_connections[room_id].items():
                if user_id != exclude_user_id and connections:
                    conn_tasks.extend(
                        [conn.send_text(message_json) for conn in connections]
                    )

            if conn_tasks:
                await asyncio.gather(*conn_tasks, return_exceptions=True)

    def _invalidate_presence_cache(self, room_id: str):
        if room_id in self.presence_cache:
            self.presence_cache.pop(room_id, None)

    async def update_presence(
            self, user_id: str, room_id: str, status: str, last_active: datetime = None
    ):

        timestamp = (
            last_active.isoformat() if last_active else datetime.utcnow().isoformat()
        )

        if room_id not in self.user_presence:
            self.user_presence[room_id] = {}

        self.user_presence[room_id][user_id] = {
            "status": status,
            "last_active": timestamp,
        }

        self._invalidate_presence_cache(room_id)
        await self.broadcast_presence(room_id)

    async def broadcast_presence(self, room_id: str):
        current_time = time.time()
        cache_entry = self.presence_cache.get(room_id)
        if (
                cache_entry
                and current_time - cache_entry["timestamp"] < self.presence_cache_ttl
        ):
            presence_message = cache_entry["message"]
        else:
            presence_message = {
                "type": "presence",
                "presence": self.user_presence.get(room_id, {}),
            }
            self.presence_cache[room_id] = {
                "message": presence_message,
                "timestamp": current_time,
            }

        await self.broadcast(presence_message, room_id)

    def get_active_users(self, room_id: str) -> List[str]:
        return [
            user_id
            for user_id, presence_data in self.user_presence[room_id].items()
            if isinstance(presence_data, dict)
               and presence_data.get("status") == "active"
        ]
