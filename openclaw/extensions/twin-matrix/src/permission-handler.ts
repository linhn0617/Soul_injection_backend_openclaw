/**
 * /getPermission 指令 Handler
 *
 * 用戶完成 bindAndGrant 後輸入此指令，
 * 呼叫 backend 查鏈上授權範圍，並觸發 inject 寫入 md
 */

import { getActiveAgentId } from "./active-map.js";
import { inject } from "./inject.js";
import { getBackendUrl } from "./runtime.js";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";

export type GetPermissionResult = {
  text: string;
};

export async function handleGetPermission(
  senderId: string | undefined,
): Promise<GetPermissionResult> {
  if (!senderId) {
    return { text: "Unable to identify your Telegram account. Please try again." };
  }

  // 取得 active agentId
  const agentId = await getActiveAgentId(senderId);
  if (!agentId) {
    return {
      text: "No active agent found. Please click the activation link first.",
    };
  }

  // 查 backend permission
  const res = await fetch(
    `${getBackendUrl()}/v1/permission/resolve?agentId=${encodeURIComponent(agentId)}`,
  );

  if (!res.ok) {
    const err = await res.text();
    return { text: `❌ Failed to fetch permission (${res.status}): ${err}` };
  }

  const permission = (await res.json()) as {
    valid: boolean;
    reason?: string;
    owner?: string;
    scope?: string[];
    expiry?: string;
  };

  if (!permission.valid) {
    return {
      text: [
        `⚠️ Authorization not yet granted.`,
        ``,
        `Reason: ${permission.reason ?? "unknown"}`,
        ``,
        `Please complete authorization on the website first, then try again.`,
      ].join("\n"),
    };
  }

  // Permission 有效 → 觸發 inject，寫入 md
  const workspaceDir = resolveWorkspaceDirForAgent(agentId);
  try {
    const result = await inject(agentId, workspaceDir);

    const layers = result.layers.length > 0
      ? result.layers.map((s) => `• ${s}`).join("\n")
      : "(none)";
    const expiryDate = new Date(result.expiry).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const lines = [
      `✅ Authorization loaded!`,
      ``,
      `Agent: \`${agentId}\``,
      `Owner: \`${result.owner}\``,
      `Expires: ${expiryDate}`,
      ``,
      `Authorized scopes:`,
      layers,
    ];

    if (result.denied.length > 0) {
      lines.push(``, `⚠️ Unavailable scopes: ${result.denied.join(", ")}`);
    }

    lines.push(``, `You can now send messages to start interacting.`);

    return { text: lines.join("\n") };
  } catch (err) {
    return {
      text: `❌ Failed to load projections: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
