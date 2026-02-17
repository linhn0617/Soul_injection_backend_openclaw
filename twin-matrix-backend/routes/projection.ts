/**
 * Projection Routes (V2)
 *
 * 從 SBT 合約讀取 matrix 並轉換成語義投影格式，供 OpenClaw inject 使用。
 *
 * 流程：
 *   1. 載入 agent record（取得 owner + agentAddress + encryptedKey）
 *   2. tokenIdOf(ownerAddress)                           → tokenId
 *   3. getAuthorizedLatestValues(tokenId, agentPrivKey)  → raw uint8[256]
 *   4. 解析 raw 數值 → domain projections（現階段只回 mobility）
 *   5. 回傳 { agentId, tokenId, projections }
 *
 * API: GET /v1/projection?agentId=
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../index.js";
import { getTokenIdOf, getAuthorizedLatestValues } from "../chain/index.js";
import type { AgentRecord } from "./agent.js";

// =========================================================================
// Domain projection types
// =========================================================================

type DomainProjection = {
  soul: Record<string, number>;
  skill: Record<string, number>;
};

// =========================================================================
// Mapping: raw uint8[256] → domain projections
//
// 現階段只回 mobility scope（bit 3）。
// 256-dim 稀疏向量規格（uint8 0-255）：
//   raw[21], raw[22] : freq score (low, high half)
//   raw[26], raw[27] : duration score
//   raw[30], raw[31] : steps score
//   raw[32]          : sport_running (rank-weighted)
//   raw[33]          : sport_cycling
//   raw[35]          : sport_trail
//   raw[36]          : sport_strength
//   raw[37]          : sport_yoga
//   raw[64]          : brand_nike
//   raw[65]          : brand_adidas
//   raw[68]          : brand_new_balance
//   raw[69]          : brand_asics
//   raw[72]          : brand_on
//   raw[86]          : BAR_PASSIVE_ACTIVE right
//   raw[156]         : BAR_SOLO_GROUP right
// =========================================================================

/** uint8 值（0-255）正規化為 0~1 */
function normalizeUint8(value: number): number {
  return Math.round((value / 255) * 100) / 100;
}

/** raw uint8[256] → { mobility: DomainProjection }（現階段只回 mobility） */
function parseRawToProjections(raw: number[]): Record<string, DomainProjection> {
  const n = normalizeUint8;
  return {
    mobility: {
      soul: {
        sport_running:  n(raw[32] ?? 0),   // rank-weighted
        sport_cycling:  n(raw[33] ?? 0),
        sport_trail:    n(raw[35] ?? 0),
        sport_strength: n(raw[36] ?? 0),
        sport_yoga:     n(raw[37] ?? 0),
        passive_active: n(raw[86] ?? 0),   // BAR_PASSIVE_ACTIVE right
        solo_group:     n(raw[156] ?? 0),  // BAR_SOLO_GROUP right
      },
      skill: {
        freq_score:        Math.round(((raw[21] ?? 0) + (raw[22] ?? 0)) / 510 * 100) / 100,
        duration_score:    Math.round(((raw[26] ?? 0) + (raw[27] ?? 0)) / 510 * 100) / 100,
        steps_score:       Math.round(((raw[30] ?? 0) + (raw[31] ?? 0)) / 510 * 100) / 100,
        brand_nike:        n(raw[64] ?? 0),
        brand_adidas:      n(raw[65] ?? 0),
        brand_new_balance: n(raw[68] ?? 0),
        brand_asics:       n(raw[69] ?? 0),
        brand_on:          n(raw[72] ?? 0),
      },
    },
  };
}

// =========================================================================
// Layer detection (based on 256-dim vector index ranges)
// =========================================================================

const LAYER_RANGES: [string, number, number][] = [
  ["Physical", 0, 63],
  ["Digital", 64, 127],
  ["Social", 128, 191],
  ["Spiritual", 192, 255],
];

function detectLayers(indices: number[]): string[] {
  return LAYER_RANGES
    .filter(([, lo, hi]) => indices.some(idx => idx >= lo && idx <= hi))
    .map(([name]) => name);
}

// =========================================================================
// Agent record loader
// =========================================================================

async function loadAgent(agentId: string): Promise<AgentRecord | null> {
  const filePath = path.join(DATA_DIR, "agents", `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

// =========================================================================
// Router
// =========================================================================

export function createProjectionRouter(): Router {
  const router = createRouter();

  /**
   * GET /v1/projection?agentId=
   *
   * 1. 載入 agent record → owner, agentAddress, encryptedKey
   * 2. tokenIdOf(owner) → tokenId
   * 3. getAuthorizedLatestValues(tokenId) with agentAddress as caller → raw[64]
   * 4. parse → projections
   *
   * Response: { agentId, ownerAddress, tokenId, projections }
   */
  router.get("/v1/projection", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.query as { agentId?: string };

      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

      // 1. 載入 agent record
      const agent = await loadAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      if (!agent.agentAddress) {
        res.status(400).json({ error: "Agent not yet registered on-chain (agentAddress missing)" });
        return;
      }

      if (!agent.encryptedKey) {
        res.status(500).json({ error: "Agent private key not available" });
        return;
      }

      const ownerAddress = agent.owner;

      // 2. tokenIdOf(ownerAddress) → tokenId
      const tokenId = await getTokenIdOf(ownerAddress);

      // 3. getAuthorizedLatestValues(tokenId) ← called from agentAddress
      const matrixData = await getAuthorizedLatestValues(tokenId, agent.encryptedKey);

      // 4. parse raw → domain projections
      const projections = parseRawToProjections(matrixData.raw);

      res.json({
        agentId,
        ownerAddress,
        tokenId: tokenId.toString(),
        projections,
        layers: detectLayers(matrixData.indices),
      });
    } catch (err) {
      console.error("projection error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
