/**
 * Permission Routes
 *
 * GET /v1/permission/resolve?agentId=
 *   查詢龍蝦的鏈上授權狀態
 *
 * CHAIN_ENABLED=false → mock 資料（sbt-reader mock mode）
 * CHAIN_ENABLED=true  → 查 SBT 合約 getPermission(agentAddress)
 *
 * 已移除：
 *   POST /v1/permission/grant — 使用者直接在前端用 MetaMask 簽鏈上 bindAndGrant
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../index.js";
import { getPermission } from "../chain/index.js";
import type { AgentRecord } from "./agent.js";

// scopeMask bit → domain 名稱對應（開會後確認 bitmask 規格）
const SCOPE_BIT_MAP: Record<number, string> = {
  0: "style",
  1: "food",
  2: "home",
  3: "mobility",
  4: "entertainment",
  5: "learning",
  6: "beauty",
};

function scopeMaskToScopes(mask: bigint): string[] {
  return Object.entries(SCOPE_BIT_MAP)
    .filter(([bit]) => (mask & (BigInt(1) << BigInt(bit))) !== BigInt(0))
    .map(([, name]) => name);
}

async function loadAgent(agentId: string): Promise<AgentRecord | null> {
  const filePath = path.join(DATA_DIR, "agents", `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

export function createPermissionRouter(): Router {
  const router = createRouter();

  /**
   * GET /v1/permission/resolve?agentId=
   *
   * 查詢 agentId 的鏈上授權狀態
   * 1. 從 agent record 取得 agentAddress
   * 2. 查鏈上（或 mock）getPermission(agentAddress)
   * 3. scopeMask → scope[] 轉換後回傳
   *
   * Response: { valid, owner, agentId, scope, expiry, permissionVersion }
   */
  router.get("/v1/permission/resolve", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.query as { agentId?: string };

      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

      // 查 agent record 取得 agentAddress
      const agent = await loadAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      const agentAddress = agent.agentAddress;
      if (!agentAddress) {
        res.json({
          valid: false,
          reason: "Agent not yet registered on-chain (ERC8004 pending)",
        });
        return;
      }

      console.info(
        `[permission] resolve start agentId=${agentId} owner=${agent.owner} agentAddress=${agentAddress}`,
      );

      // 查鏈上 permission
      let permission;
      try {
        permission = await getPermission(agent.owner, agentAddress, agent.encryptedKey ?? "");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Normalize technical call errors into user-facing hints.
        let reason = msg;
        if (msg.includes("Agent key mismatch")) {
          reason =
            "Agent wallet key mismatch. Please re-bind this agent so the on-chain agentAddress and local key are consistent.";
        } else if (msg.includes("is not bound to owner")) {
          reason =
            "Agent is not bound to this SBT owner on-chain yet. Please complete bind on the website first.";
        } else if (msg.includes("not authorized to read this SBT matrix")) {
          reason =
            "Agent is not granted permission yet (bindAndGrant missing/expired or caller mismatch).";
        }

        res.json({
          valid: false,
          reason: `Permission not yet available: ${reason}`,
        });
        console.warn(
          `[permission] resolve failed agentId=${agentId} owner=${agent.owner} agentAddress=${agentAddress} reason=${reason}`,
        );
        return;
      }

      if (!permission.valid) {
        res.json({ valid: false, reason: "No permission found for agent" });
        return;
      }

      if (new Date() > new Date(permission.expiry)) {
        res.json({
          valid: false,
          reason: "Permission expired",
          agentId,
          expiry: permission.expiry,
        });
        return;
      }

      const scope = scopeMaskToScopes(permission.scopeMask);

      res.json({
        valid: true,
        owner: permission.owner,
        agentId,
        agentAddress,
        scope,
        expiry: permission.expiry,
        permissionVersion: permission.permissionVersion ?? 1,
      });
      console.info(
        `[permission] resolve ok agentId=${agentId} owner=${permission.owner} agentAddress=${agentAddress}`,
      );
    } catch (err) {
      console.error("permission/resolve error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
