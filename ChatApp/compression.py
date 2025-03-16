import asyncio
from base64 import b64encode, b64decode
from typing import Tuple

import zstandard as zstd


class MessageCompression:
    def __init__(self, compression_level: int = 3):
        """Initialize with configurable compression level (1-22)"""
        self.compression_level = compression_level
        self.compressor = zstd.ZstdCompressor(level=compression_level)
        self.decompressor = zstd.ZstdDecompressor()

    def compress_message(self, content: str) -> Tuple[str, bool]:
        """
        Compress message content if beneficial.
        Returns (compressed_content, is_compressed)
        """
        if not content or len(content) < 100:  # Don't compress small messages
            return content, False

        try:
            compressed = self.compressor.compress(content.encode("utf-8"))
            compressed_b64 = b64encode(compressed).decode("utf-8")

            # Only use compression if it actually saves space
            if len(compressed_b64) < len(content):
                return compressed_b64, True
            return content, False
        except Exception as e:
            print(f"Compression error: {e}")
            return content, False

    def decompress_message(self, content: str, is_compressed: bool) -> str:
        """Decompress message content if it was compressed"""
        if not is_compressed or not content:
            return content

        try:
            # Always treat as base64 encoded data
            compressed_data = b64decode(content.encode("utf-8"))
            decompressed = self.decompressor.decompress(compressed_data)
            return decompressed.decode("utf-8")
        except Exception as e:
            print(f"Decompression error: {str(e)}")
            return "[Decompression failed]"

    async def process_message_batch(
            self, messages: list, room_id: str, message_encryption
    ) -> None:
        """Process a batch of messages - handling both decompression and decryption"""
        for msg in messages:
            if msg.get("message_type") == "image":
                continue

            try:
                # First decrypt if message is encrypted
                if msg.get("encrypted") and msg.get("content") and msg.get("nonce"):
                    msg["content"] = await asyncio.to_thread(
                        message_encryption.decrypt_message,
                        msg["content"],
                        msg["nonce"],
                        room_id,
                    )

                # Then decompress if message was compressed
                if msg.get("compressed"):
                    msg["content"] = self.decompress_message(msg["content"], True)

            except Exception as e:
                print(f"Error processing message {msg.get('_id')}: {e}")
                msg["content"] = "[Processing failed]"
