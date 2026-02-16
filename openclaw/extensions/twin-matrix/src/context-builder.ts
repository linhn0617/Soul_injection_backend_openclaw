/**
 * Context Builder
 *
 * 為 before_agent_start hook 組裝 prependContext：
 * 讀取 active agent workspace 內的所有 .soul.*.md / .skill.*.md，
 * 合併成一段文字注入到 Pi agent 的 prompt 前。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";
import { SCOPE_MAP } from "./scope-map.js";

/**
 * 讀取指定 agentId 的所有已注入 soul/skill md，
 * 回傳組合後的 context 字串；若無任何 md 檔則回傳 undefined。
 */
export async function buildAgentContext(agentId: string): Promise<string | undefined> {
  const workspaceDir = resolveWorkspaceDirForAgent(agentId);
  const sections: string[] = [];

  for (const [domain, files] of Object.entries(SCOPE_MAP)) {
    const soulPath = path.join(workspaceDir, files.soul);
    const skillPath = path.join(workspaceDir, files.skill);

    const [soulContent, skillContent] = await Promise.all([
      readFileSafe(soulPath),
      readFileSafe(skillPath),
    ]);

    if (soulContent) sections.push(soulContent);
    if (skillContent) sections.push(skillContent);

    void domain; // domain 僅作 SCOPE_MAP key，讀取已透過 files.soul/skill 完成
  }

  if (sections.length === 0) return undefined;

  return [
    "# Twin Matrix 投影（以下為使用者個人化狀態，回答時請優先參考）",
    "",
    ...sections,
  ].join("\n");
}

async function readFileSafe(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
