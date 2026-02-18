/**
 * Mission Routes (Demo)
 *
 * 目前先提供「建立固定模板假任務」：
 *   POST /v1/mission/create-demo
 *
 * 後續步驟（TG 接受/提交、轉帳、前端查詢）會再分段補上。
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../index.js";
import { getAuthorizedLatestValues, getPermission, getTokenIdOf, transferUsdt } from "../chain/index.js";
import type { AgentRecord } from "./agent.js";

const AGENTS_DIR = () => path.join(DATA_DIR, "agents");
const MISSIONS_DIR = () => path.join(DATA_DIR, "missions");

const DEMO_AGENT_NAME = "Nike Running Agent";
const MISSION_EXPIRE_SECONDS = 30;
const RUNNING_TO_SUBMIT_MS = 3000;

type MissionTemplate = {
  taskName: string;
  rewardUsdt: number;
};

const DEMO_MISSION_TEMPLATES: MissionTemplate[] = [
  {
    taskName: "Adidas Training Lab 7-day Training Feedback for Ultraboost",
    rewardUsdt: 0.8,
  },
  {
    taskName: "HOKA Performance Field Test: Trail Cushion Feedback (2 weeks)",
    rewardUsdt: 0.9,
  },
  {
    taskName: "Strava Insights Weekly Running Pattern Analysis (4 weeks)",
    rewardUsdt: 0.7,
  },
  {
    taskName: "New Balance Lab Daily Step Consistency Check (14 days)",
    rewardUsdt: 0.6,
  },
];

const SCOPE_BIT_MAP: Record<number, string> = {
  0: "style",
  1: "food",
  2: "home",
  3: "mobility",
  4: "entertainment",
  5: "learning",
  6: "beauty",
};

export type MissionStatus =
  | "pending_accept"
  | "running"
  | "await_submit"
  | "completed"
  | "expired";

export type MissionRecord = {
  id: string;
  agentId: string;
  agentAddress: string;
  owner: string;
  taskName: string;
  agentName: string;
  rewardUsdt: number;
  status: MissionStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  transferTxHash?: string;
};

type MissionRecordWithScope = MissionRecord & {
  scope: string[];
};

const QUADRANT_RANGES: [string, number, number][] = [
  ["physical", 0, 63],
  ["digital", 64, 127],
  ["social", 128, 191],
  ["spiritual", 192, 255],
];

function scopeMaskToScopes(mask: bigint): string[] {
  return Object.entries(SCOPE_BIT_MAP)
    .filter(([bit]) => (mask & (BigInt(1) << BigInt(bit))) !== BigInt(0))
    .map(([, name]) => name);
}

function pickRandomMissionTemplate(): MissionTemplate {
  const idx = Math.floor(Math.random() * DEMO_MISSION_TEMPLATES.length);
  return DEMO_MISSION_TEMPLATES[idx] ?? DEMO_MISSION_TEMPLATES[0]!;
}

function createMissionId(): string {
  return `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function detectAuthorizedQuadrants(indices: number[]): string[] {
  return QUADRANT_RANGES
    .filter(([, lo, hi]) => indices.some((idx) => idx >= lo && idx <= hi))
    .map(([name]) => name);
}

function pickRandomScopesFromAuthorized(authorized: string[], maxPick = 2): string[] {
  const shuffled = [...authorized].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(maxPick, shuffled.length));
}

function findLatestMissionIndex(
  missions: MissionRecord[],
  status: MissionStatus,
): number {
  let bestIndex = -1;
  let bestTime = 0;
  for (const [idx, mission] of missions.entries()) {
    if (mission.status !== status) continue;
    const ts = Date.parse(mission.updatedAt || mission.createdAt);
    if (Number.isNaN(ts)) continue;
    if (bestIndex < 0 || ts > bestTime) {
      bestIndex = idx;
      bestTime = ts;
    }
  }
  return bestIndex;
}

function applyMissionStateTransitions(missions: MissionRecord[]): {
  missions: MissionRecord[];
  changed: boolean;
} {
  const now = new Date();
  const next = missions.map((mission) => ({ ...mission }));
  let changed = false;

  for (const mission of next) {
    // running 超過 3 秒，自動進入 await_submit，並重設 30 秒過期視窗
    if (mission.status === "running") {
      const startedAt = Date.parse(mission.updatedAt || mission.createdAt);
      if (!Number.isNaN(startedAt) && now.getTime() - startedAt >= RUNNING_TO_SUBMIT_MS) {
        mission.status = "await_submit";
        mission.updatedAt = now.toISOString();
        mission.expiresAt = new Date(now.getTime() + MISSION_EXPIRE_SECONDS * 1000).toISOString();
        changed = true;
      }
    }

    // pending_accept / await_submit 超時則標記 expired
    if (
      (mission.status === "pending_accept" || mission.status === "await_submit") &&
      now > new Date(mission.expiresAt)
    ) {
      mission.status = "expired";
      mission.updatedAt = now.toISOString();
      changed = true;
    }
  }

  return { missions: next, changed };
}

async function loadAgent(agentId: string): Promise<AgentRecord | null> {
  const filePath = path.join(AGENTS_DIR(), `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

async function loadAgentMissions(agentId: string): Promise<MissionRecord[]> {
  const filePath = path.join(MISSIONS_DIR(), `${agentId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as MissionRecord[];
  } catch {
    return [];
  }
}

async function saveAgentMissions(agentId: string, missions: MissionRecord[]): Promise<void> {
  await fs.mkdir(MISSIONS_DIR(), { recursive: true });
  const filePath = path.join(MISSIONS_DIR(), `${agentId}.json`);
  await fs.writeFile(filePath, JSON.stringify(missions, null, 2), "utf-8");
}

async function listAgentsByOwner(owner: string): Promise<AgentRecord[]> {
  await fs.mkdir(AGENTS_DIR(), { recursive: true });
  const files = await fs.readdir(AGENTS_DIR());
  const agents: AgentRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(AGENTS_DIR(), file), "utf-8");
      const agent = JSON.parse(raw) as AgentRecord;
      if (agent.owner.toLowerCase() === owner.toLowerCase()) {
        agents.push(agent);
      }
    } catch {
      // skip corrupted files
    }
  }
  return agents;
}

export function createMissionRouter(): Router {
  const router = createRouter();

  /**
   * POST /v1/mission/create-demo
   *
   * Body: { agentId }
   *
   * 建立（或覆蓋）固定模板假任務 active-1
   */
  router.post("/v1/mission/create-demo", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

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
        res.status(400).json({ error: "Agent private key missing (encryptedKey missing)" });
        return;
      }

      // 依當前 agent 的鏈上授權 scope 產生任務 scope（與 /getPermission 同源）
      let authorizedScopes: string[];
      try {
        const permission = await getPermission(agent.owner, agent.agentAddress, agent.encryptedKey);
        if (!permission.valid) {
          res.status(400).json({ error: "Agent has no valid permission on-chain" });
          return;
        }
        authorizedScopes = scopeMaskToScopes(permission.scopeMask);
      } catch (err) {
        res.status(400).json({
          error: `Failed to load on-chain permission: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      if (authorizedScopes.length === 0) {
        res.status(400).json({ error: "Agent has no authorized scopes available for mission" });
        return;
      }

      const now = new Date();
      const template = pickRandomMissionTemplate();
      const mission: MissionRecord = {
        id: createMissionId(),
        agentId: agent.agentId,
        agentAddress: agent.agentAddress,
        owner: agent.owner,
        taskName: template.taskName,
        agentName: agent.agentName || DEMO_AGENT_NAME,
        rewardUsdt: template.rewardUsdt,
        status: "pending_accept",
        expiresAt: new Date(now.getTime() + MISSION_EXPIRE_SECONDS * 1000).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const missions = await loadAgentMissions(agentId);
      const nextMissions = [...missions, mission];
      await saveAgentMissions(agentId, nextMissions);

      res.json({
        ok: true,
        mission,
      });
    } catch (err) {
      console.error("mission/create-demo error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /v1/mission/accept
   *
   * Body: { agentId }
   *
   * 接受 active-1 任務：
   *   pending_accept -> running
   * 3 秒後自動轉成 await_submit，並重設 expiresAt（推播後 30 秒過期）
   */
  router.post("/v1/mission/accept", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

      const loaded = await loadAgentMissions(agentId);
      const transitioned = applyMissionStateTransitions(loaded);
      const missions = transitioned.missions;
      if (transitioned.changed) {
        await saveAgentMissions(agentId, missions);
      }

      const index = findLatestMissionIndex(missions, "pending_accept");
      if (index < 0) {
        res.status(404).json({ error: `No pending mission found for agent: ${agentId}` });
        return;
      }

      const mission = missions[index];
      if (!mission) {
        res.status(404).json({ error: `Demo mission not found for agent: ${agentId}` });
        return;
      }

      const now = new Date();
      if (now > new Date(mission.expiresAt)) {
        mission.status = "expired";
        mission.updatedAt = now.toISOString();
        missions[index] = mission;
        await saveAgentMissions(agentId, missions);
        res.status(400).json({ error: "Mission expired" });
        return;
      }

      if (mission.status !== "pending_accept") {
        res.status(400).json({
          error: `Mission is not pending_accept (current: ${mission.status})`,
        });
        return;
      }

      mission.status = "running";
      mission.updatedAt = now.toISOString();
      // 接受任務後維持一個有效視窗，避免剛好在 pending 視窗尾端時立即被判定 expired
      mission.expiresAt = new Date(now.getTime() + MISSION_EXPIRE_SECONDS * 1000).toISOString();
      missions[index] = mission;
      await saveAgentMissions(agentId, missions);

      setTimeout(async () => {
        try {
          const current = await loadAgentMissions(agentId);
          const currentIndex = current.findIndex((m) => m.id === mission.id);
          if (currentIndex < 0) return;
          const currentMission = current[currentIndex];
          if (!currentMission || currentMission.status !== "running") return;

          const shiftedAt = new Date();
          currentMission.status = "await_submit";
          currentMission.expiresAt = new Date(
            shiftedAt.getTime() + MISSION_EXPIRE_SECONDS * 1000,
          ).toISOString();
          currentMission.updatedAt = shiftedAt.toISOString();
          current[currentIndex] = currentMission;
          await saveAgentMissions(agentId, current);
        } catch (err) {
          console.error("mission/accept async transition error:", err);
        }
      }, RUNNING_TO_SUBMIT_MS);

      res.json({
        ok: true,
        text: "I have started working on the mission!",
        mission,
      });
    } catch (err) {
      console.error("mission/accept error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /v1/mission/complete
   *
   * Body: { agentId }
   *
   * 提交並完成任務：
   *   await_submit -> completed
   *   同步執行 USDT 轉帳（VENDOR_PRIVATE_KEY -> agentAddress）
   */
  router.post("/v1/mission/complete", async (req: Request, res: Response) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }

      const loaded = await loadAgentMissions(agentId);
      const transitioned = applyMissionStateTransitions(loaded);
      const missions = transitioned.missions;
      if (transitioned.changed) {
        await saveAgentMissions(agentId, missions);
      }

      const index = findLatestMissionIndex(missions, "await_submit");
      if (index < 0) {
        res.status(404).json({ error: `No mission awaiting submit for agent: ${agentId}` });
        return;
      }

      const mission = missions[index];
      if (!mission) {
        res.status(404).json({ error: `Demo mission not found for agent: ${agentId}` });
        return;
      }

      const now = new Date();
      if (now > new Date(mission.expiresAt)) {
        mission.status = "expired";
        mission.updatedAt = now.toISOString();
        missions[index] = mission;
        await saveAgentMissions(agentId, missions);
        res.status(400).json({ error: "Mission expired" });
        return;
      }

      if (mission.status !== "await_submit") {
        res.status(400).json({
          error: `Mission is not await_submit (current: ${mission.status})`,
        });
        return;
      }

      const { txHash } = await transferUsdt({
        to: mission.agentAddress,
        amountUsdt: mission.rewardUsdt,
      });

      const completedAt = new Date().toISOString();
      mission.status = "completed";
      mission.updatedAt = completedAt;
      mission.completedAt = completedAt;
      mission.transferTxHash = txHash;
      missions[index] = mission;
      await saveAgentMissions(agentId, missions);

      res.json({
        ok: true,
        text: "Mission approved. USDT transfer is now processing.",
        successText: "USDT has been transferred to the agent wallet.",
        txHash,
        mission,
      });
    } catch (err) {
      console.error("mission/complete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /v1/mission/list?owner=<SBT-address>
   * GET /v1/mission/list?sbtAddress=<SBT-address>
   *
   * 依 SBT 地址（owner wallet）查詢旗下所有 agent 任務。
   * 回傳每筆 mission 時附上該 agent 的授權 scope（由鏈上 permission 計算）。
   */
  router.get("/v1/mission/list", async (req: Request, res: Response) => {
    try {
      const { owner, sbtAddress } = req.query as { owner?: string; sbtAddress?: string };
      const resolvedOwner = owner?.trim() || sbtAddress?.trim();
      if (!resolvedOwner) {
        res.status(400).json({ error: "owner or sbtAddress is required" });
        return;
      }

      const agents = await listAgentsByOwner(resolvedOwner);
      const allMissions: MissionRecordWithScope[] = [];
      const tokenIdByOwner = new Map<string, bigint>();

      for (const agent of agents) {
        const loaded = await loadAgentMissions(agent.agentId);
        if (loaded.length === 0) continue;

        const transitioned = applyMissionStateTransitions(loaded);
        const missions = transitioned.missions;
        if (transitioned.changed) {
          await saveAgentMissions(agent.agentId, missions);
        }

        let agentScopes: string[] = [];
        if (agent.agentAddress && agent.encryptedKey) {
          try {
            let tokenId = tokenIdByOwner.get(agent.owner);
            if (!tokenId) {
              tokenId = await getTokenIdOf(agent.owner);
              tokenIdByOwner.set(agent.owner, tokenId);
            }

            const matrix = await getAuthorizedLatestValues(tokenId, agent.encryptedKey);
            const authorizedQuadrants = detectAuthorizedQuadrants(matrix.indices);
            agentScopes = pickRandomScopesFromAuthorized(authorizedQuadrants, 2);
          } catch {
            // keep scopes as []
          }
        }

        const normalized = missions.map((mission) => ({
          ...mission,
          scope: agentScopes,
        })) as MissionRecordWithScope[];

        allMissions.push(...normalized);
      }

      res.json({
        owner: resolvedOwner,
        missions: allMissions,
      });
    } catch (err) {
      console.error("mission/list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
