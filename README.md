# Agentic QA System

FastAPI + SQLite + Vanilla JS implementation of the QA Scenario Management System described in the provided PDF.

## Included

- Scenario CRUD for title, description, test steps, expected results, and priority
- Topic and message storage for testing discussions
- Asynchronous message enrichment with an Agno QA analyst agent using a local Ollama model by default
- Deterministic fallback enrichment when the configured model provider is unavailable
- Excel and Word export endpoints for stored scenarios
- A single-page frontend served by FastAPI

## Project Structure

```text
backend/
  main.py
  config.py
  database.py
  models/
  routers/
  services/
frontend/
  index.html
  styles.css
  scenarios.js
  discussions.js
main.py
requirements.txt
```

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Open `http://127.0.0.1:8000`.

## Ollama Setup

The default agent backend is `Agno + Ollama`.

1. Install Ollama locally.
2. Pull a model:

```bash
ollama pull llama3.1:8b
```

3. Start Ollama if it is not already running.
4. Start the app with `python main.py`.

By default the app uses:

- `AGNO_PROVIDER=ollama`
- `AGNO_MODEL=llama3.1:8b`
- `AGNO_BASE_URL=` which means Ollama's default local endpoint

If Ollama is unavailable, message enrichment falls back to a deterministic rules-based summary instead of failing the request.

## API Summary

- `POST /scenarios`
- `GET /scenarios`
- `GET /scenarios/{id}`
- `PUT /scenarios/{id}`
- `DELETE /scenarios/{id}`
- `POST /topics`
- `GET /topics`
- `POST /topics/{id}/messages`
- `GET /topics/{id}/messages`
- `GET /export/scenarios/excel`
- `GET /export/scenarios/word`

Swagger UI is available at `http://127.0.0.1:8000/docs`.

## Agno Integration

The backend includes:

- `backend/services/agno_agents/qa_agent.py` for QA discussion enrichment
- `backend/services/agno_agents/scenario_agent.py` for structured scenario generation
- `backend/services/agno_agents/model_factory.py` for selecting the Agno model provider
- `backend/services/agno_agents/tools.py` for agent tools over topic history and stored scenarios

Supported providers are:

- `ollama` for local Ollama models
- `lmstudio` for a local LM Studio server
- `disabled` for forced fallback mode
