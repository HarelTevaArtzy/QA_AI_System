from __future__ import annotations

from agno.models.base import Model

from backend.config import Settings


class AgentProviderDisabledError(RuntimeError):
    pass


def build_model(settings: Settings) -> Model:
    provider = settings.agno_provider

    if provider == "disabled":
        raise AgentProviderDisabledError("AGNO_PROVIDER=disabled, so live model enrichment is off.")

    if provider == "ollama":
        from agno.models.ollama import Ollama

        kwargs = {"id": settings.agno_model}
        if settings.ai_base_url:
            kwargs["host"] = settings.ai_base_url
        return Ollama(**kwargs)

    if provider == "lmstudio":
        from agno.models.lmstudio import LMStudio

        kwargs = {"id": settings.agno_model}
        if settings.ai_base_url:
            kwargs["base_url"] = settings.ai_base_url
        return LMStudio(**kwargs)

    raise ValueError(
        f"Unsupported AGNO_PROVIDER '{settings.agno_provider}'. Use ollama, lmstudio, or disabled."
    )
