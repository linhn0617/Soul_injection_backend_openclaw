/**
 * /lobsters Handler
 *
 * 列出使用者所有已綁定龍蝦及目前 active 狀態。
 */

import { getActiveAgentId } from "./active-map.js";
import { getBackendUrl } from "./runtime.js";
import { loadState } from "./state.js";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";

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

export async function handleLobsters(senderId: string | undefined): Promise<{ text: string }> {
  if (!senderId) {
    return { text: "Unable to identify your Telegram account. Please try again." };
  }

  let agents: AgentRecord[];
  try {
    agents = await listAgents(senderId);
  } catch (err) {
    return {
      text: `❌ Failed to fetch agent list.\n${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (agents.length === 0) {
    return {
      text: "You don't have any agents yet.\nPlease create one on the Twin Matrix website to get an authorization link.",
    };
  }

  const activeAgentId = await getActiveAgentId(senderId);

  const lines: string[] = ["🦞 Your agents:", ""];

  for (const [i, agent] of agents.entries()) {
    const isActive = agent.agentId === activeAgentId;
    const workspaceDir = resolveWorkspaceDirForAgent(agent.agentId);
    const state = await loadState(workspaceDir);
    const inject = state.lastInject;

    const scopes = inject?.injectedScopes.join(", ") ?? "(not yet injected)";
    const expiry = inject
      ? new Date(inject.expiry).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "-";
    const expired = inject ? new Date(inject.expiry) < new Date() : false;
    const statusTag = isActive ? " ✅ active" : expired ? " ⚠️ expired" : "";

    lines.push(`${i + 1}. ${agent.agentType}${statusTag}`);
    lines.push(`   Domains: ${scopes}`);
    lines.push(`   Expires: ${expiry}`);
    lines.push("");
  }

  lines.push("/switch <number or name> to switch agent");

  return { text: lines.join("\n") };
}
