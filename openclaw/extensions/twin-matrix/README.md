# extensions/twin-matrix

OpenClaw plugin that implements Twin Matrix Soul-to-Agent Injection. It reads a user's on-chain identity vector via the backend, transforms it into semantic projections, and injects personalized context into the AI agent at inference time.

## Overview

After a user completes identity creation and authorization on the web frontend, this extension handles:

1. **Deep link binding**: receives Telegram deep link from the frontend, binds the Telegram user to an agentId.
2. **Projection injection**: fetches authorized projections from the backend and writes `.soul.md` / `.skill.md` files into the agent workspace.
3. **Context injection**: hooks into `before_agent_start` to prepend soul/skill context to the agent prompt on every turn.
4. **Multi-agent switching**: supports multiple agents per user with `/switch` and `/lobsters` commands.

## Prerequisites

- `twin-matrix-backend` running at `http://localhost:3400` (or set via `TWIN_MATRIX_BACKEND_URL`)
- OpenClaw core with `before_agent_start` hook support

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start <payload>` | Deep link entry — bind agent + inject projections |
| `/switch <n\|name>` | Switch active agent by index or name |
| `/lobsters` | List all bound agents and current active status |
| `/acceptMission` | Accept a pending mission |
| `/missionComplete` | Submit completed mission and trigger USDT transfer |

## How It Works

```
User sends message in Telegram
        │
        ▼
before_agent_start hook fires
        │
        ▼
Extension resolves active agent for this Telegram user
        │
        ▼
Reads .soul.md / .skill.md from agent workspace
        │
        ▼
Injects as prepended context → agent responds with personalized identity
```

## Implemented On-chain Features

- ERC-8004 on-chain self-registration during `/start` flow
- `agentAddress` reported back to the backend after registration
- Live on-chain authorization query via `getPermission(agentAddress)`

## Tech Stack

- **Language**: TypeScript
- **Plugin API**: OpenClaw extension system (`api.registerCommand`, `api.on`)
- **Backend communication**: REST calls to twin-matrix-backend
