# twin-matrix-backend

Twin Matrix Backend is the off-chain service layer for the Twin Matrix identity system. It handles AI agent lifecycle management, on-chain authorization queries, and matrix projection computation, serving as the bridge between the SBT contract and the OpenClaw agent runtime.

## Project Overview

This backend serves three roles in the Twin Matrix architecture:

- **Agent lifecycle**: register, bind, and resolve AI agents linked to on-chain SBT identities.
- **Authorization gateway**: read on-chain permissions (scoped, time-bounded grants) and expose them to the agent runtime.
- **Projection engine**: transform raw 256-dimensional on-chain vectors into semantic soul/skill projections that OpenClaw agents consume at inference time.

The backend does not store user identity data or handle authorization signing. All authorization transactions are signed directly by the user via the frontend wallet.

## Architecture

```
Frontend (Web)     Compute matrix scores  → write to SBT contract
                   Sign authorization tx  → write on-chain grant
Backend (this)     Agent management + on-chain reads + projection compute
OpenClaw           Query backend for projections → inject personalized soul/skill
```

## Related Repositories

- Smart contracts: https://github.com/BrianYCCheng/TwinMatrixSBT
- Frontend: https://github.com/gisellelaycc/sweet-ui-magic

## Repository Structure

- `index.ts`: Express server entry point
- `routes/`: API route handlers (agent, permission, projection, alignment, mission)
- `chain/`: on-chain interaction layer (ethers.js v6, SBT reader, agent registry)
- `.env.example`: environment variable template

## Quick Start

```bash
npm install
cp .env.example .env   # fill in actual values
npx tsx index.ts
```

Server starts at `http://localhost:3400`.

## Core Flows

### Agent Activation (Flow B)

```
[Web]       Create agent → receive agentId + Telegram deep link
[Telegram]  /start → bind identity + ERC-8004 on-chain registration
[Web]       Confirm registration → user signs bindAndGrant tx
[Telegram]  User sends message → lazy inject → personalized response
```

### Permission Update (Flow C)

Users sign on-chain transactions directly from the frontend to update authorization scope. The agent automatically detects permission version changes and reloads on next inject.

## Tech Stack

- **Runtime**: Node.js + tsx
- **Framework**: Express.js
- **On-chain**: ethers.js v6
- **Chain**: BNB Smart Chain testnet
- **Standards**: ERC-8004 (Agent Registry), TwinMatrixSBT (ERC-4671-aligned)
