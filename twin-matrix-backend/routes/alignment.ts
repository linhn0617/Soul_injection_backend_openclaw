/**
 * Alignment Routes
 *
 * POST /v1/match/alignment
 *   計算龍蝦與品牌的偏好相似度，供 Molt Road bounty 匹配使用。
 *
 *   Body: { agentId, brandAgentId, brandMatrix }
 *   Response: { alignmentScore, soulContrib, skillContrib, reasons[] }
 *
 *   流程：
 *     1. 載入 agent record
 *     2. 查 permission → 取得授權 scope
 *     3. 依 scope 計算 soul / skill 對齊分數
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../index.js";
import { getPermission } from "../chain/index.js";
import type { AgentRecord } from "./agent.js";

async function loadAgent(agentId: string): Promise<AgentRecord | null> {
  const filePath = path.join(DATA_DIR, "agents", `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

export function createAlignmentRouter(): Router {
  const router = createRouter();

  /**
   * POST /v1/match/alignment
   *
   * Body:
   *   agentId      - 龍蝦 ID
   *   brandAgentId - 品牌方 agent ID（記錄用）
   *   brandMatrix  - 品牌偏好向量 { [key]: number }
   *
   * Response: { alignmentScore, soulContrib, skillContrib, reasons[] }
   */
  router.post("/v1/match/alignment", async (req: Request, res: Response) => {
    try {
      const { agentId, brandAgentId, brandMatrix } = req.body as {
        agentId: string;
        brandAgentId: string;
        brandMatrix: Record<string, number>;
      };

      if (!agentId || !brandAgentId || !brandMatrix) {
        res.status(400).json({ error: "agentId, brandAgentId, brandMatrix are required" });
        return;
      }

      // 1. 載入 agent record
      const agent = await loadAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      if (!agent.agentAddress) {
        res.status(400).json({ error: "Agent not yet registered on-chain (ERC8004 pending)" });
        return;
      }

      // 2. 查 permission → 取得授權 scope
      const permission = await getPermission(agent.agentAddress);
      if (!permission.valid) {
        res.status(403).json({ error: "Agent has no valid permission" });
        return;
      }

      // scopeMask → scope 名稱
      const SCOPE_BIT_MAP: Record<number, string> = {
        0: "style", 1: "food", 2: "home", 3: "mobility",
        4: "entertainment", 5: "learning", 6: "beauty",
      };
      const authorizedScopes = Object.entries(SCOPE_BIT_MAP)
        .filter(([bit]) => (permission.scopeMask & (BigInt(1) << BigInt(bit))) !== BigInt(0))
        .map(([, name]) => name);

      // 3. 依授權 scope 計算對齊分數
      //    - soul contrib：從快取投影檔讀取（若存在），否則跳過
      //    - skill contrib：品牌 matrix key 與 brandMatrix 的向量內積
      const projectionsDir = path.join(DATA_DIR, "projections");
      let soulContrib = 0;
      let skillContrib = 0;
      const reasons: string[] = [];
      let soulDomainCount = 0;
      let skillDomainCount = 0;

      for (const scope of authorizedScopes) {
        const projPath = path.join(projectionsDir, `${agent.owner}_${scope}.json`);
        try {
          const raw = await fs.readFile(projPath, "utf-8");
          const proj = JSON.parse(raw) as {
            soul: Record<string, number>;
            skill: Record<string, number>;
          };

          // Soul：各維度平均
          const soulVals = Object.values(proj.soul).filter((v) => typeof v === "number");
          if (soulVals.length > 0) {
            soulContrib += soulVals.reduce((a, b) => a + b, 0) / soulVals.length;
            soulDomainCount++;
          }

          // Skill：與 brandMatrix 的 key 重疊內積
          let overlap = 0;
          let overlapCount = 0;
          for (const [key, userVal] of Object.entries(proj.skill)) {
            if (brandMatrix[key] !== undefined) {
              overlap += userVal * brandMatrix[key];
              overlapCount++;
              reasons.push(`[${scope}] ${key}: user=${userVal}, brand=${brandMatrix[key]}`);
            }
          }
          if (overlapCount > 0) {
            skillContrib += overlap / overlapCount;
            skillDomainCount++;
          }
        } catch {
          // 快取不存在時跳過該 scope
        }
      }

      if (soulDomainCount > 0) soulContrib /= soulDomainCount;
      if (skillDomainCount > 0) skillContrib /= skillDomainCount;

      const alignmentScore = soulContrib * 0.4 + skillContrib * 0.6;

      res.json({
        alignmentScore: Math.round(alignmentScore * 100) / 100,
        soulContrib: Math.round(soulContrib * 100) / 100,
        skillContrib: Math.round(skillContrib * 100) / 100,
        authorizedScopes,
        reasons,
      });
    } catch (err) {
      console.error("alignment error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
