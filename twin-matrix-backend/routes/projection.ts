/**
 * Projection Routes (V2)
 *
 * 從 SBT 合約讀取 matrix 並轉換成語義投影格式，供 OpenClaw inject 使用。
 *
 * 流程：
 *   1. 載入 agent record（取得 owner + agentAddress + encryptedKey）
 *   2. tokenIdOf(ownerAddress)                           → tokenId
 *   3. getAuthorizedLatestValues(tokenId, agentPrivKey)  → raw int8[64]
 *   4. 解析 raw 數值 → domain projections
 *   5. 回傳 { agentId, tokenId, projections }
 *
 * API: GET /v1/projection?agentId=
 *
 * TODO: raw 數值的 domain 欄位對應需與合約工程師確認實際 byte 位置
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
// Mapping: raw int8[64] → domain projections
//
// TODO: 確認實際 byte index 位置（待合約工程師說明）
// 目前以均分方式分配：7 domains × 9 values ≈ 63 values（最後 1 byte 保留）
// byte 0~3   : style soul (4 dims)
// byte 4~7   : style skill (4 dims)
// byte 8~11  : food soul
// byte 12~15 : food skill
// byte 16~19 : home soul
// byte 20~23 : home skill
// byte 24~27 : mobility soul
// byte 28~31 : mobility skill
// byte 32~35 : entertainment soul
// byte 36~39 : entertainment skill
// byte 40~43 : learning soul
// byte 44~47 : learning skill
// byte 48~51 : beauty soul
// byte 52~55 : beauty skill
// byte 56~63 : reserved
// =========================================================================

const SOUL_KEYS: Record<string, string[]> = {
  style:         ["visibility_preference", "identity_expression", "contextual_adaptability", "trend_sensitivity"],
  food:          ["flavor_preference", "dining_social_mode", "adventurousness", "health_consciousness"],
  home:          ["space_aesthetic", "functional_priority", "personalization_level", "ambiance_sensitivity"],
  mobility:      ["travel_purpose", "speed_preference", "eco_consciousness", "spontaneity"],
  entertainment: ["media_preference", "social_vs_solo", "intensity_preference", "genre_openness"],
  learning:      ["learning_style", "depth_vs_breadth", "theory_vs_practice", "self_directed"],
  beauty:        ["appearance_priority", "routine_commitment", "brand_loyalty", "experimental_level"],
};

const SKILL_KEYS: Record<string, string[]> = {
  style:         ["brand_recognition", "style_consistency", "trend_adoption", "budget_tier"],
  food:          ["cuisine_breadth", "cooking_skill", "dining_frequency", "price_sensitivity"],
  home:          ["deco_skill", "brand_affinity", "renovation_willingness", "sustainability_score"],
  mobility:      ["platform_familiarity", "route_planning", "cost_optimization", "flexibility"],
  entertainment: ["platform_usage", "content_diversity", "engagement_depth", "social_sharing"],
  learning:      ["retention_rate", "platform_diversity", "completion_rate", "application_skill"],
  beauty:        ["product_knowledge", "routine_adherence", "ingredient_awareness", "brand_affinity"],
};

const DOMAINS = ["style", "food", "home", "mobility", "entertainment", "learning", "beauty"];

/** int8 值（-128~127）正規化為 0~1 */
function normalizeInt8(value: number): number {
  return Math.round(((value + 128) / 255) * 100) / 100;
}

/** raw int8[64] → { [domain]: DomainProjection } */
function parseRawToProjections(raw: number[]): Record<string, DomainProjection> {
  const projections: Record<string, DomainProjection> = {};

  DOMAINS.forEach((domain, domainIdx) => {
    const baseOffset = domainIdx * 8;
    const soulKeys = SOUL_KEYS[domain] ?? [];
    const skillKeys = SKILL_KEYS[domain] ?? [];

    const soul: Record<string, number> = {};
    soulKeys.forEach((key, i) => {
      soul[key] = normalizeInt8(raw[baseOffset + i] ?? 0);
    });

    const skill: Record<string, number> = {};
    skillKeys.forEach((key, i) => {
      skill[key] = normalizeInt8(raw[baseOffset + 4 + i] ?? 0);
    });

    projections[domain] = { soul, skill };
  });

  return projections;
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
      });
    } catch (err) {
      console.error("projection error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
