"""Per-attempt observability, kept separate from model inputs and thread-safe."""

from contextvars import ContextVar
from copy import deepcopy
import json

import anthropic


_last_trace: ContextVar[dict | None] = ContextVar("agent_last_trace", default=None)


def publish_trace(trace: dict) -> None:
    _last_trace.set(trace)


def take_trace() -> dict | None:
    trace = _last_trace.get()
    _last_trace.set(None)
    return trace


def error_details(error: Exception) -> dict:
    """Do not persist API response bodies, request headers or credentials."""
    if isinstance(error, anthropic.APIError):
        details = {"type": type(error).__name__, "message": "Anthropic request failed"}
        if isinstance(error, anthropic.APIStatusError):
            details["status_code"] = error.status_code
        return details
    return {"type": type(error).__name__, "message": str(error)[:500]}


def tool_calls(messages: list[dict]) -> list[dict]:
    """Read the real SDK transcript; never execute a tool or retain model thinking."""
    calls = []
    by_id = {}
    for message in messages:
        content = message.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            def field(name, default=None):
                return block.get(name, default) if isinstance(block, dict) else getattr(block, name, default)

            if message["role"] == "assistant" and field("type") == "tool_use":
                call = {"id": field("id"), "name": field("name"),
                        "arguments": deepcopy(field("input", {})), "status": "pending", "result": None}
                calls.append(call)
                by_id[call["id"]] = call
            elif message["role"] == "user" and field("type") == "tool_result":
                call = by_id.get(field("tool_use_id"))
                if call is None:
                    continue
                result = field("content", "")
                if isinstance(result, list):
                    result = "\n".join(item.get("text", "") for item in result if item.get("type") == "text")
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except (ValueError, TypeError):
                        pass
                call["result"] = result
                call["status"] = "error" if field("is_error", False) else "ok"
    return calls
