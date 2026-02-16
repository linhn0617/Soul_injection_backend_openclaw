/**
 * State (V2)
 *
 * InjectState 加入 agentId / owner 欄位
 * versionId 降為 audit-only（記錄注入時的 matrix 版本，不作授權語義）
 */

import fs from "node:fs/promises";
import path from "node:path";

export type InjectState = {
  agentId: string;           // V2：身份錨點
  owner: string;             // V2：owner SBT / userId
  userId: string;            // Matrix 資料所屬 userId
  permissionVersion: number; // V2：permission 版本號
  injectedScopes: string[];
  deniedScopes: string[];
  injectedAt: string;
  expiry: string;
  // audit fields（不作授權語義）
  auditVersionId?: string;
  auditChecksum?: string;
};

export type StateFile = {
  lastInject?: InjectState;
};

export async function loadState(workspaceDir: string): Promise<StateFile> {
  const statePath = path.join(workspaceDir, ".twin-matrix-state.json");
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw) as StateFile;
  } catch {
    return {};
  }
}

export async function saveState(workspaceDir: string, state: StateFile): Promise<void> {
  const statePath = path.join(workspaceDir, ".twin-matrix-state.json");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}
