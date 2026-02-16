/**
 * Active Agent Map
 *
 * 儲存每個 Telegram user 目前 active 的 agentId。
 * 格式：{ "tg_user_123": "agent_abc", ... }
 *
 * 檔案位置：~/.openclaw/workspace/.twin-matrix-active.json
 * （放在預設 workspace，與 agentId workspace 分開）
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function getActiveMapPath(): string {
  return path.join(os.homedir(), ".openclaw", "workspace", ".twin-matrix-active.json");
}

type ActiveMap = Record<string, string>; // telegramUserId → agentId

async function readActiveMap(): Promise<ActiveMap> {
  try {
    const raw = await fs.readFile(getActiveMapPath(), "utf-8");
    return JSON.parse(raw) as ActiveMap;
  } catch {
    return {};
  }
}

async function writeActiveMap(map: ActiveMap): Promise<void> {
  const filePath = getActiveMapPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(map, null, 2), "utf-8");
}

/** 取得目前 active agentId（找不到回傳 undefined） */
export async function getActiveAgentId(telegramUserId: string): Promise<string | undefined> {
  const map = await readActiveMap();
  return map[telegramUserId];
}

/** 設定 active agentId */
export async function setActiveAgentId(telegramUserId: string, agentId: string): Promise<void> {
  const map = await readActiveMap();
  map[telegramUserId] = agentId;
  await writeActiveMap(map);
}
