/**
 * Agent Routes (V2)
 *
 * agentId 是穩定身份錨點（對應鏈上 ERC8004）
 * 生命週期獨立於 permission 更新，不因授權變更而重建
 *
 * API:
 *   POST /v1/agent/register   — 建立 agentId（Web 端呼叫）
 *   POST /v1/agent/bind       — 綁定 telegramUserId → agentId
 *   GET  /v1/agent/resolve    — 查詢 agentId 完整資訊
 *   GET  /v1/agent/list?owner — 列出某 owner 的所有 agent
 *
 * 資料存放：data/agents/{agentId}.json
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../index.js";
import { registerAgentOnChain } from "../chain/index.js";

export type AgentRecord = {
  agentId: string;
  owner: string;              // wallet address（ownerAddress）
  tokenId?: string;           // 使用者的 SBT tokenId
  agentName: string;          // 龍蝦名稱（前端傳入，上鏈 ERC8004 用）
  agentType: string;          // "fashion" | "sport" | "shopping" | "general"
  agentAddress?: string;      // 龍蝦錢包地址（ERC8004 完成後填入）
  encryptedKey?: string;      // 龍蝦私鑰（TODO: 加密存儲）
  telegramUserId?: string;    // 綁定後填入
  telegramPayload?: string;   // deep link payload（綁定前暫存）
  status: "pending" | "active" | "revoked";
  createdAt: string;
  updatedAt: string;
};

const AGENTS_DIR = () => path.join(DATA_DIR, "agents");

async function loadAgent(agentId: string): Promise<AgentRecord | null> {
  const filePath = path.join(AGENTS_DIR(), `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

async function saveAgent(agent: AgentRecord): Promise<void> {
  await fs.mkdir(AGENTS_DIR(), { recursive: true });
  const filePath = path.join(AGENTS_DIR(), `${agent.agentId}.json`);
  await fs.writeFile(filePath, JSON.stringify(agent, null, 2), "utf-8");
}

async function listAgents(filter: { owner?: string; telegramUserId?: string }): Promise<AgentRecord[]> {
  await fs.mkdir(AGENTS_DIR(), { recursive: true });
  const files = await fs.readdir(AGENTS_DIR());
  const agents: AgentRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(AGENTS_DIR(), file), "utf-8");
      const agent = JSON.parse(raw) as AgentRecord;
      if (filter.owner && agent.owner !== filter.owner) continue;
      if (filter.telegramUserId && agent.telegramUserId !== filter.telegramUserId) continue;
      agents.push(agent);
    } catch {
      // skip corrupted files
    }
  }
  return agents;
}

export function createAgentRouter(): Router {
  const router = createRouter();

  /**
   * POST /v1/agent/register
   *
   * Web 端建立龍蝦時呼叫，產生 agentId 與 Telegram deep link
   *
   * Body: { ownerAddress, tokenId, agentName }
   * Response: { agentId, deepLink }
   */
  router.post("/v1/agent/register", async (req: Request, res: Response) => {
    try {
      const { ownerAddress, tokenId, agentName } = req.body as {
        ownerAddress: string;
        tokenId?: string;
        agentName?: string;
      };

      if (!ownerAddress) {
        res.status(400).json({ error: "ownerAddress is required" });
        return;
      }

      const agentId = `agent_${crypto.randomBytes(8).toString("hex")}`;
      const now = new Date().toISOString();

      // Telegram deep link payload：直接用 agentId（22 字元，符合 TG 64 字元上限）
      // 注意：JSON base64url 編碼後超過 64 字元，TG 會截斷導致 /start 無參數
      const telegramPayload = agentId;

      const agent: AgentRecord = {
        agentId,
        owner: ownerAddress,
        tokenId,
        agentName: agentName || "Twin Matrix Agent",
        agentType: "general",
        telegramPayload,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };

      await saveAgent(agent);

      const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "YourBot";
      const deepLink = `https://t.me/${botUsername}?start=${telegramPayload}`;

      res.json({ agentId, deepLink });
    } catch (err) {
      console.error("agent/register error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /v1/agent/bind
   *
   * Telegram 端收到 /start <payload> 後回呼，綁定 telegramUserId → agentId
   *
   * Body: { payload, telegramUserId }
   * Response: { agentId, owner, telegramUserId, status }
   */
  router.post("/v1/agent/bind", async (req: Request, res: Response) => {
    try {
      const { payload, telegramUserId } = req.body as {
        payload: string;
        telegramUserId: string;
      };

      if (!payload || !telegramUserId) {
        res.status(400).json({ error: "payload and telegramUserId are required" });
        return;
      }

      // 解析 payload：支援新格式（直接 agentId）與舊格式（base64url JSON）
      let agentId: string;
      const trimmed = payload.trim();
      if (/^agent_[0-9a-f]+$/.test(trimmed)) {
        agentId = trimmed;
      } else {
        try {
          const decoded = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as { agentId?: string };
          if (!decoded.agentId) throw new Error("missing agentId");
          agentId = decoded.agentId;
        } catch {
          res.status(400).json({ error: "Invalid payload" });
          return;
        }
      }

      const agent = await loadAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      agent.telegramUserId = telegramUserId;
      agent.status = "active";
      agent.updatedAt = new Date().toISOString();
      await saveAgent(agent);

      // 產龍蝦錢包 + ERC8004 鏈上註冊（mock 或真實）
      const tokenId = agent.tokenId ?? "0";
      const { agentAddress, privateKey } = await registerAgentOnChain(agent.owner, tokenId, agent.agentName);

      agent.agentAddress = agentAddress;
      agent.encryptedKey = privateKey;   // TODO: 加密存儲
      agent.updatedAt = new Date().toISOString();
      await saveAgent(agent);

      res.json({
        agentId: agent.agentId,
        owner: agent.owner,
        agentType: agent.agentType,
        telegramUserId,
        status: agent.status,
        agentAddress,
      });
    } catch (err) {
      console.error("agent/bind error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /v1/agent/resolve?agentId=
   *
   * 查詢 agentId 的完整資訊（身份資料 + 綁定狀態）
   *
   * Response: AgentRecord
   */
  router.get("/v1/agent/resolve", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.query as { agentId?: string };

      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

      const agent = await loadAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      res.json(agent);
    } catch (err) {
      console.error("agent/resolve error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /v1/agent/list?owner=
   *
   * 列出某 owner 的所有龍蝦
   *
   * Response: { agents: AgentRecord[] }
   */
  router.get("/v1/agent/list", async (req: Request, res: Response) => {
    try {
      const { owner, telegramUserId } = req.query as {
        owner?: string;
        telegramUserId?: string;
      };

      if (!owner && !telegramUserId) {
        res.status(400).json({ error: "owner or telegramUserId is required" });
        return;
      }

      const agents = await listAgents({ owner, telegramUserId });
      res.json({ agents });
    } catch (err) {
      console.error("agent/list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
