# Soul Injection Backend — OpenClaw

This repository contains the backend infrastructure for Twin Matrix, an identity system that injects verifiable human context ("soul") into personal AI agents. It includes the off-chain service layer and the OpenClaw agent extension that together power the soul injection pipeline.

## Project Overview

Twin Matrix anchors a user's structured identity vector on-chain via a soulbound token (SBT) and binds AI agents to that identity with scoped, time-bounded permissions. This repository implements the off-chain half of that system:

- **twin-matrix-backend**: REST API service handling agent lifecycle, on-chain authorization queries, and matrix projection computation.
- **openclaw/extensions/twin-matrix**: OpenClaw plugin that reads projections from the backend and injects personalized soul/skill context into the agent at inference time.

The on-chain identity data flows through these components as follows:

```
SBT Contract (on-chain 256-dim vector)
        │
        ▼
twin-matrix-backend (read + project)
        │
        ▼
OpenClaw Extension (inject soul/skill into agent prompt)
        │
        ▼
AI Agent responds with personalized context
```

## Related Repositories

- Smart contracts: https://github.com/BrianYCCheng/TwinMatrixSBT
- Frontend: https://github.com/gisellelaycc/sweet-ui-magic

## Repository Structure

```
├── twin-matrix-backend/          # Off-chain service layer (Express.js)
│   ├── index.ts                  # Server entry point
│   ├── routes/                   # API route handlers
│   ├── chain/                    # On-chain interaction (ethers.js v6)
│   └── .env.example              # Environment variable template
│
└── openclaw/                     # OpenClaw fork with Twin Matrix extension
    └── extensions/twin-matrix/   # Soul injection plugin
        ├── index.ts              # Plugin entry (commands + hooks)
        └── src/                  # Injection logic, state, handlers
```

## Quick Start

```bash
cd twin-matrix-backend
npm install
cp .env.example .env   # fill in actual values
npx tsx index.ts
```

The OpenClaw gateway requires additional configuration (API keys, Telegram bot token, extension wiring) beyond what is tracked in this repository. See deployment documentation for details.

## Core Flows

### Agent Activation

1. User creates an agent on the web frontend, receives a Telegram deep link.
2. User opens the link in Telegram, triggering `/start` — the extension binds the agent and registers it on-chain (ERC-8004).
3. User returns to the frontend and signs a `bindAndGrant` transaction to authorize data access.
4. On next message, the agent lazily injects the user's soul/skill projections and responds with personalized context.

### Soul Injection

The OpenClaw extension hooks into `before_agent_start` to inject soul/skill markdown files as prepended context. Projections are derived from the on-chain 256-dimensional identity vector, scoped by the user's granted permissions.

## Tech Stack

- **Runtime**: Node.js + tsx
- **Framework**: Express.js
- **On-chain**: ethers.js v6
- **Agent runtime**: OpenClaw (Docker)
- **Chain**: BNB Smart Chain testnet
- **Standards**: ERC-8004 (Agent Registry), TwinMatrixSBT (ERC-4671-aligned)
