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

import { getActiveAgentId, setActiveAgentId } from "./active-map.js";
import { getBackendUrl } from "./runtime.js";

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
  agentAddress?: string;
};

type ParsedPayload = {
  agentId: string;
};

/** 解析 Telegram deep link payload
 * 支援兩種格式：
 * 1. 新格式：agentId 直接作為 payload（agent_xxxxxxxxxxxxxxxx）
 * 2. 舊格式：base64url(JSON { agentId, ... })
 */
function parsePayload(raw: string): ParsedPayload {
  const trimmed = raw.trim();

  // 新格式：直接是 agentId
  if (/^agent_[0-9a-f]+$/.test(trimmed)) {
    return { agentId: trimmed };
  }

  // 舊格式：base64url JSON
  try {
    const decoded = Buffer.from(trimmed, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded) as { agentId?: string };
    if (parsed.agentId) return { agentId: parsed.agentId };
  } catch {
    // fall through
  }

  throw new Error(`Invalid payload format: ${raw.slice(0, 30)}`);
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

  // 3. 設定 active agent
  // /start deep-link 成功 bind 後，應以該 agent 作為目前 active，
  // 避免沿用舊 active 導致 /getPermission 查錯地址。
  const nextActiveAgentId = bindResult.agentId || agentId;
  await setActiveAgentId(senderId, nextActiveAgentId);

  // 4. ERC8004 完成，提示用戶回網頁授權
  // inject 不在此處執行，待用戶完成 bindAndGrant 後，
  // 下一則訊息的 before_agent_start hook 會自動觸發 lazy inject
  if (bindResult.agentAddress) {
    return {
      text: [
        `✅ Agent activated!`,
        `🔗 Agent address: \`${bindResult.agentAddress}\``,
        ``,
        `Please return to the website and complete authorization.`,
        `Once done, type /getPermission to load your authorized scopes.`,
      ].join("\n"),
    };
  }

  return {
    text: [
      `✅ Agent bound (${agentId})`,
      ``,
      `Please return to the website and complete authorization.`,
      `Once done, type /getPermission to load your authorized scopes.`,
    ].join("\n"),
  };
}
