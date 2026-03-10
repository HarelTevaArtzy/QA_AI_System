# Agentic QA System

FastAPI + SQLite + Vanilla JS implementation of a structured QA management platform with requirements, linked test scenarios, discussions, and role-based access control.

## Included

- Authentication with persistent bearer sessions and role-based permissions for `admin`, `qa`, and `viewer`
- Admin user management for creating, updating, and deleting accounts
- Requirements management with parent-child hierarchy support
- Requirement-to-scenario traceability so each test can cover one or more requirements
- Requirement-driven scenario generation and direct scenario creation from selected requirements
- Scenario CRUD for title, description, test steps, expected results, and priority
- Topic and message storage for testing discussions
- Asynchronous message enrichment with an Agno QA analyst agent using a local Ollama model by default
- Deterministic fallback enrichment when the configured model provider is unavailable
- Excel and Word export endpoints for stored scenarios, including linked requirements
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
  auth.js
  requirements.js
  index.html
  styles.css
  scenarios.js
  discussions.js
tests/
main.py
requirements.txt
qa_system.db
```

## Run

```bash
pip install -r requirements.txt
python main.py
```

Open `http://127.0.0.1:8000`.

## Run With Docker

### Option A: Docker Compose (recommended)

```bash
docker compose up --build -d
```

Open `http://127.0.0.1:8000`.

Stop:

```bash
docker compose down
```

This keeps SQLite data in a named Docker volume (`qa_ai_data`).

### Option B: Plain Docker

```bash
docker build -t qa-ai-system .
docker run --name qa-ai-system -p 8000:8000 -e DATABASE_FILE=/app/data/qa_system.db -v qa_ai_data:/app/data qa-ai-system
```

## Default Admin Login

On first startup, the system creates a bootstrap admin account if no users exist.

- `DEFAULT_ADMIN_USERNAME` defaults to `admin`
- `DEFAULT_ADMIN_PASSWORD` defaults to `ADMIN123`

Override both in the environment before starting the app in any non-test environment.

When using Docker Compose, you can override variables by creating a `.env` file in the project root (see `.env.example`).

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

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /users`
- `POST /users`
- `PUT /users/{id}`
- `DELETE /users/{id}`
- `POST /requirements`
- `GET /requirements`
- `GET /requirements/{id}`
- `PUT /requirements/{id}`
- `DELETE /requirements/{id}`
- `POST /requirements/{id}/scenarios`
- `POST /requirements/{id}/scenario-suggestions`
- `POST /requirements/{id}/scenario-suggestions/save`
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
