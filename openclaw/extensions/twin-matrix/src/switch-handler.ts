/**
 * /switch <編號|名稱> Handler
 *
 * 切換 active 龍蝦：
 * 1. GET /v1/agent/list?telegramUserId= 取得使用者龍蝦清單
 * 2. 依 args 比對編號或 agentType 名稱（模糊）
 * 3. 若 workspace 尚無 soul/skill md → 自動 inject
 * 4. 更新 active map
 * 5. 回傳確認訊息
 */

import { getBackendUrl } from "./runtime.js";
import { getActiveAgentId, setActiveAgentId } from "./active-map.js";
import { inject } from "./inject.js";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";
import { loadState } from "./state.js";

type AgentRecord = {
  agentId: string;
  agentType: string;
  owner: string;
  telegramUserId?: string;
  status: string;
};

async function listAgents(telegramUserId: string): Promise<AgentRecord[]> {
  const url = `${getBackendUrl()}/v1/agent/list?telegramUserId=${encodeURIComponent(telegramUserId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent/list failed (${res.status})`);
  const data = (await res.json()) as { agents: AgentRecord[] };
  return data.agents ?? [];
}

export async function handleSwitch(
  args: string | undefined,
  senderId: string | undefined,
): Promise<{ text: string }> {
  if (!senderId) {
    return { text: "Unable to identify your Telegram account. Please try again." };
  }

  if (!args?.trim()) {
    return { text: "Please specify an agent number or name.\ne.g. /switch 1 or /switch fashion" };
  }

  // 取得使用者龍蝦清單
  let agents: AgentRecord[];
  try {
    agents = await listAgents(senderId);
  } catch (err) {
    return {
      text: `❌ Failed to fetch agent list.\n${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (agents.length === 0) {
    return { text: "You don't have any agents yet.\nPlease create one on the Twin Matrix website to get an authorization link." };
  }

  // 比對：編號或名稱（模糊）
  const query = args.trim();
  const byIndex = /^\d+$/.test(query) ? agents[parseInt(query, 10) - 1] : undefined;
  const byName = agents.find(
    (a) => a.agentType.includes(query) || query.includes(a.agentType),
  );
  const target = byIndex ?? byName;

  if (!target) {
    const list = agents.map((a, i) => `${i + 1}. ${a.agentType}`).join("\n");
    return { text: `Agent "${query}" not found.\n\nYour agents:\n${list}` };
  }

  const { agentId, agentType } = target;
  const currentActive = await getActiveAgentId(senderId);

  if (currentActive === agentId) {
    return { text: `${agentType} is already the active agent.` };
  }

  // 若 workspace 尚無 inject 狀態 → 自動 inject
  const workspaceDir = resolveWorkspaceDirForAgent(agentId);
  const state = await loadState(workspaceDir);
  if (!state.lastInject) {
    try {
      await inject(agentId, workspaceDir);
    } catch (err) {
      return {
        text: [
          `⚠️ Switch failed: unable to load Twin Matrix projections for ${agentType}.`,
          `Please make sure on-chain authorization is complete.`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ].join("\n"),
      };
    }
  }

  // 更新 active map
  await setActiveAgentId(senderId, agentId);

  const reloadedState = await loadState(workspaceDir);
  const scopes = reloadedState.lastInject?.injectedScopes.join(", ") ?? "-";

  return {
    text: [
      `🔄 Switched to ${agentType}`,
      ``,
      `Loaded domains: ${scopes}`,
      `You can now send messages to interact with ${agentType}.`,
    ].join("\n"),
  };
}
