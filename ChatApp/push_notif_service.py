import asyncio
import time
from datetime import datetime
from typing import Optional, Dict, List

import aiohttp
import firebase_admin
import google.auth
from firebase_admin import messaging

class FirebaseNotificationService:
    def __init__(self):
        self.app = firebase_admin.get_app()
        self.project_id = self.app.project_id
        self.auth_token = None
        self.auth_token_expiry = 0

    async def _get_auth_token(self):
        """Get a valid OAuth token for FCM API requests."""
        now = int(time.time())
        if self.auth_token and now < self.auth_token_expiry - 60:
            return self.auth_token
        try:
            if hasattr(self.app.credential, 'get_access_token'):
                access_token_info = await asyncio.to_thread(
                    self.app.credential.get_access_token
                )
                self.auth_token = access_token_info.access_token
                if hasattr(access_token_info, 'expiry'):
                    self.auth_token_expiry = int(access_token_info.expiry.timestamp())
                elif hasattr(access_token_info, 'expires_in'):
                    self.auth_token_expiry = now + access_token_info.expires_in
                else:
                    self.auth_token_expiry = now + 3600
            elif hasattr(self.app.credential, 'refresh'):
                request = google.auth.transport.requests.Request()
                credentials = self.app.credential
                await asyncio.to_thread(credentials.refresh, request)
                self.auth_token = credentials.token
                self.auth_token_expiry = int(credentials.expiry.timestamp())
            else:
                self.auth_token = "using_internal_auth"
                self.auth_token_expiry = now + 3600
            return self.auth_token
        except Exception as e:
            print(f"Error getting auth token: {e}")
            raise

    async def send_to_token(
            self,
            token: str,
            title: str,
            body: str,
            data: Optional[Dict[str, str]] = None,
            image_url: Optional[str] = None,
    ):
        """Send notification to a specific device token."""
        try:
            # For single token, we can still use the Admin SDK directly
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title, body=body, image=image_url
                ),
                data=data or {},
                token=token,
            )
            return await asyncio.to_thread(messaging.send, message, app=self.app)
        except Exception as e:
            print(f"Error sending to token {token}: {str(e)}")
            return None

    async def send_to_tokens(
            self,
            tokens: List[str],
            title: str,
            body: str,
            data: Optional[Dict[str, str]] = None,
            image_url: Optional[str] = None,
    ):
        """Send notification to multiple device tokens using v1 HTTP endpoint."""
        if not tokens:
            return []

        # Chunk tokens into batches of 500 (FCM limit)
        batch_size = 500
        token_chunks = [
            tokens[i: i + batch_size] for i in range(0, len(tokens), batch_size)
        ]

        results = []
        auth_token = await self._get_auth_token()

        for chunk in token_chunks:
            try:
                # For v11.2 compatibility, use the HTTP v1 API directly
                url = f"https://fcm.googleapis.com/v1/projects/{self.project_id}/messages:send"

                headers = {
                    "Authorization": f"Bearer {auth_token}",
                    "Content-Type": "application/json"
                }

                # We'll make individual requests for each token
                # This is less efficient but more compatible
                batch_success = 0
                batch_failure = 0

                async with aiohttp.ClientSession() as session:
                    for token in chunk:
                        payload = {
                            "message": {
                                "token": token,
                                "notification": {
                                    "title": title,
                                    "body": body
                                }
                            }
                        }

                        # Add image if provided
                        if image_url:
                            payload["message"]["notification"]["image"] = image_url

                        # Add data if provided
                        if data:
                            payload["message"]["data"] = data

                        try:
                            async with session.post(url, headers=headers, json=payload) as resp:
                                if resp.status == 200:
                                    batch_success += 1
                                else:
                                    batch_failure += 1
                                    resp_text = await resp.text()
                                    print(f"FCM error for token {token}: {resp.status} - {resp_text}")
                        except Exception as token_error:
                            batch_failure += 1
                            print(f"Error sending to token {token}: {str(token_error)}")

                results.append({
                    "success_count": batch_success,
                    "failure_count": batch_failure
                })

            except Exception as e:
                print(f"Error sending to token batch: {str(e)}")
                results.append(
                    {"success_count": 0, "failure_count": len(chunk), "error": str(e)}
                )

        return results

    async def send_to_topic(
            self,
            topic: str,
            title: str,
            body: str,
            data: Optional[Dict[str, str]] = None,
            image_url: Optional[str] = None,
    ):
        """Send notification to all devices subscribed to a topic."""
        try:
            # Ensure topic name is correctly formatted
            if not topic.startswith('/topics/'):
                topic = f'/topics/{topic}'

            message = messaging.Message(
                notification=messaging.Notification(
                    title=title, body=body, image=image_url
                ),
                data=data or {},
                topic=topic,
            )
            return await asyncio.to_thread(messaging.send, message, app=self.app)
        except Exception as e:
            print(f"Error sending to topic {topic}: {str(e)}")
            return None

    async def subscribe_to_topic(self, tokens: List[str], topic: str):
        """Subscribe devices to a topic."""
        try:
            response = await asyncio.to_thread(
                messaging.subscribe_to_topic, tokens, topic, app=self.app
            )
            return {
                "success_count": response.success_count,
                "failure_count": response.failure_count,
            }
        except Exception as e:
            print(f"Error subscribing to topic {topic}: {str(e)}")
            return {"success_count": 0, "failure_count": len(tokens), "error": str(e)}

    async def unsubscribe_from_topic(self, tokens: List[str], topic: str):
        """Unsubscribe devices from a topic."""
        try:
            response = await asyncio.to_thread(
                messaging.unsubscribe_from_topic, tokens, topic, app=self.app
            )
            return {
                "success_count": response.success_count,
                "failure_count": response.failure_count,
            }
        except Exception as e:
            print(f"Error unsubscribing from topic {topic}: {str(e)}")
            return {"success_count": 0, "failure_count": len(tokens), "error": str(e)}