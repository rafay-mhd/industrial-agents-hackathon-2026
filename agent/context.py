"""Explicit user context: planning a route never implies the user has walked it."""

from dataclasses import dataclass


@dataclass
class ConversationContext:
    position: str | None = None
    step_free: bool = False
