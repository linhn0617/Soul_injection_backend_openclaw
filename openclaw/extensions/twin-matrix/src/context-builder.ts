/**
 * Context Builder
 *
 * 為 before_agent_start hook 組裝 Twin Matrix context。
 * 讀取 active agent workspace 內的 .soul.*.md / .skill.*.md，
 * 可輸出 prependContext，或更強的 systemPrompt persona override。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { SCOPE_MAP } from "./scope-map.js";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";

/**
 * 讀取指定 agentId 的所有已注入 soul/skill md，
 * 回傳組合後的 context 字串；若無任何 md 檔則回傳 undefined。
 */
export async function buildAgentContext(agentId: string): Promise<string | undefined> {
  const sections = await collectSections(agentId);
  if (sections.length === 0) return undefined;

  return ["# Twin Matrix 投影（以下為使用者個人化狀態，回答時請優先參考）", "", ...sections].join(
    "\n",
  );
}

/**
 * 建立明確 persona override：
 * - 若 workspace 存在 `.persona.override.md`，優先使用該檔作為 persona 指令。
 * - 否則使用預設 Twin Matrix persona 指令。
 * - 最後附上所有 soul/skill 投影內容，作為回答依據。
 */
export async function buildAgentPersonaOverride(agentId: string): Promise<string | undefined> {
  const workspaceDir = resolveWorkspaceDirForAgent(agentId);
  const sections = await collectSections(agentId);
  if (sections.length === 0) return undefined;

  const overridePath = path.join(workspaceDir, ".persona.override.md");
  const customOverride = (await readFileSafe(overridePath))?.trim();

  const personaHeader =
    customOverride && customOverride.length > 0
      ? customOverride
      : [
          "# Twin Matrix Persona Override",
          "",
          "你現在是此 Telegram 使用者目前啟用的 Twin Matrix agent。",
          "你的身份、語氣、偏好、價值觀與擅長領域，必須以 Twin Matrix 投影資料為唯一優先來源。",
          "若與預設系統角色衝突，請以 Twin Matrix 投影為準，不要自稱 C-3PO 或其他預設角色。",
          "若投影資料未涵蓋某問題，請明確說明資訊不足，再給出保守建議。",
          "回覆語言預設使用使用者目前對話語言。",
        ].join("\n");

  return [personaHeader, "", "## Authorized Twin Matrix Projection", "", ...sections].join("\n");
}

async function collectSections(agentId: string): Promise<string[]> {
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

    void domain;
  }
  return sections;
}

async function readFileSafe(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
