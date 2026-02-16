import os from "node:os";
import path from "node:path";

function resolveOpenClawHome(): string {
  return process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw");
}

/** 預設 workspace（單一龍蝦 / default profile） */
export function resolveWorkspaceDir(): string {
  const home = resolveOpenClawHome();
  const profile = process.env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, `workspace-${profile}`);
  }
  return path.join(home, "workspace");
}

/**
 * 依 agentId 解析對應的獨立 workspace
 * 每隻龍蝦有自己的隔離 workspace：~/.openclaw/workspace-{agentId}
 */
export function resolveWorkspaceDirForAgent(agentId: string): string {
  const home = resolveOpenClawHome();
  if (!agentId || agentId === "default") {
    return path.join(home, "workspace");
  }
  return path.join(home, `workspace-${agentId}`);
}
