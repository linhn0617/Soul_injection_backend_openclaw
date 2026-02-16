/**
 * Telegram /start <payload> Handler
 *
 * 流程：
 * 1. 解析 payload（base64url → { agentId, owner }）
 * 2. POST /v1/agent/bind（telegramUserId → agentId）
 * 3. inject(agentId, workspaceDir)  ← 查授權 + 寫入 md
 * 4. 回傳歡迎訊息
 *
 * 透過 api.registerCommand("start", { requireAuth: false }) 掛入，
 * 不需修改 Telegram extension，任何新使用者點擊 deep link 都可觸發。
 */

import { getBackendUrl } from "./runtime.js";
import { inject } from "./inject.js";
import { resolveWorkspaceDirForAgent } from "./workspace-dir.js";
import { getActiveAgentId, setActiveAgentId } from "./active-map.js";

type BindRequest = {
  payload: string;
  telegramUserId: string;
};

type BindResponse = {
  agentId: string;
  owner: string;
  agentType: string;
  telegramUserId: string;
  status: string;
};

type ParsedPayload = {
  agentId: string;
  owner: string;
};

/** 解析 Telegram deep link payload（base64url JSON） */
function parsePayload(raw: string): ParsedPayload {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf-8");
    return JSON.parse(decoded) as ParsedPayload;
  } catch {
    throw new Error(`Invalid payload format: ${raw.slice(0, 20)}...`);
  }
}

/** 呼叫 Backend /v1/agent/bind */
async function bindAgent(payload: string, telegramUserId: string): Promise<BindResponse> {
  const body: BindRequest = { payload, telegramUserId };
  const res = await fetch(`${getBackendUrl()}/v1/agent/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`agent/bind failed (${res.status}): ${err}`);
  }
  return res.json() as Promise<BindResponse>;
}

/** 格式化歡迎訊息 */
function buildWelcomeMessage(params: {
  agentId: string;
  agentType: string;
  injectedScopes: string[];
  deniedScopes: string[];
  expiry: string;
}): string {
  const { agentId, agentType, injectedScopes, deniedScopes, expiry } = params;
  const scopeList = injectedScopes.map((s) => `• ${s}`).join("\n") || "(none)";
  const expiryDate = new Date(expiry).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines = [
    `🧬 Twin Matrix agent is ready`,
    ``,
    `Agent: \`${agentId}\``,
    `Type: ${agentType}`,
    `Authorization expires: ${expiryDate}`,
    ``,
    `Loaded domain projections:`,
    scopeList,
  ];

  if (deniedScopes.length > 0) {
    lines.push(``, `⚠️ The following domains are not authorized or unavailable:`);
    lines.push(...deniedScopes.map((s) => `• ${s}`));
  }

  lines.push(
    ``,
    `You can now send messages to start interacting.`,
    `e.g. "Recommend an outfit for today"`,
  );

  return lines.join("\n");
}

export type StartResult = {
  text: string;
};

/**
 * 主處理函數，由 registerCommand("start") handler 呼叫
 *
 * @param payload  - ctx.args（deep link payload 字串）
 * @param senderId - ctx.senderId（Telegram user ID）
 */
export async function handleTelegramStart(
  payload: string | undefined,
  senderId: string | undefined,
): Promise<StartResult> {
  // No payload means plain /start (not a deep link)
  if (!payload?.trim()) {
    return {
      text: "Welcome to Twin Matrix!\nPlease create your agent on the Twin Matrix website to get an authorization link.",
    };
  }

  if (!senderId) {
    return { text: "Unable to identify your Telegram account. Please try again." };
  }

  // 1. 解析 payload
  let parsed: ParsedPayload;
  try {
    parsed = parsePayload(payload);
  } catch (err) {
    return {
      text: `❌ Invalid authorization link.\n${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { agentId } = parsed;

  // 2. 綁定 telegramUserId → agentId
  let bindResult: BindResponse;
  try {
    bindResult = await bindAgent(payload, senderId);
  } catch (err) {
    return {
      text: `❌ Agent binding failed.\n${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Inject：查鏈上授權 + 取得最新投影 + 寫入 md
  const workspaceDir = resolveWorkspaceDirForAgent(agentId);
  let injectResult: Awaited<ReturnType<typeof inject>>;
  try {
    injectResult = await inject(agentId, workspaceDir);
  } catch (err) {
    // inject 失敗通常是 permission 尚未 grant，告知使用者
    return {
      text: [
        `✅ Agent bound (${agentId})`,
        ``,
        `⚠️ On-chain authorization not yet granted. Twin Matrix projections cannot be loaded.`,
        `Please complete authorization on the Twin Matrix website first, then send a message.`,
        ``,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      ].join("\n"),
    };
  }

  // 4. 若使用者尚無 active agent，設為 active
  const currentActive = await getActiveAgentId(senderId);
  const isFirstBind = !currentActive;
  if (isFirstBind) {
    await setActiveAgentId(senderId, agentId);
  }

  // 5. 回傳歡迎訊息
  const welcomeText = buildWelcomeMessage({
    agentId,
    agentType: bindResult.agentType,
    injectedScopes: injectResult.injected,
    deniedScopes: injectResult.denied,
    expiry: injectResult.expiry,
  });

  if (!isFirstBind) {
    return {
      text: [
        welcomeText,
        ``,
        `💡 You have another agent currently active.`,
        `Type /switch ${bindResult.agentType} to switch to this agent,`,
        `or /lobsters to see all your agents.`,
      ].join("\n"),
    };
  }

  return { text: welcomeText };
}
