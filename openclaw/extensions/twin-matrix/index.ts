/**
 * Twin Matrix Plugin (V2)
 *
 * Telegram 指令（chat）：
 *   /start <payload>  — deep link 觸發：bind + inject + 歡迎訊息
 *   /switch <n|name>  — 切換 active 龍蝦
 *   /lobsters         — 列出所有已綁定龍蝦
 *
 * CLI 指令（terminal）：
 *   twin-matrix inject --agent <agentId>   — 查鏈上授權並注入最新投影
 *   twin-matrix status [--agent <agentId>] — 查看 inject 狀態
 *   twin-matrix reset --scope <scopes>     — 清除 md 檔
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { configureRuntime } from "./src/runtime.js";

const twinMatrixPlugin = {
  id: "twin-matrix",
  name: "Twin Matrix",
  description: "Twin Matrix Soul-to-Agent Injection",
  kind: "utility",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const config = api.config as Record<string, unknown> | undefined;
    if (config?.backendUrl && typeof config.backendUrl === "string") {
      configureRuntime({ backendUrl: config.backendUrl });
    }

    // =========================================================================
    // Telegram Commands
    // =========================================================================

    /**
     * /start <payload>
     *
     * Deep link 觸發：bind + inject + 歡迎訊息
     * requireAuth: false — 新使用者（尚未在白名單）也可觸發
     * acceptsArgs: true  — payload 透過 ctx.args 傳入
     */
    api.registerCommand({
      name: "start",
      description: "Twin Matrix deep link entry (bind and load projection)",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleTelegramStart } = await import("./src/start-handler.js");
        return handleTelegramStart(ctx.args, ctx.senderId);
      },
    });

    /**
     * /switch <編號|名稱>
     *
     * 切換目前 active 的龍蝦。
     * - 依編號（1/2/3）或 agentType 名稱模糊比對
     * - 若對應 workspace 尚無 soul/skill md，自動觸發 inject
     */
    api.registerCommand({
      name: "switch",
      description: "Switch active agent",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleSwitch } = await import("./src/switch-handler.js");
        return handleSwitch(ctx.args, ctx.senderId);
      },
    });

    /**
     * /getPermission
     *
     * 用戶完成 bindAndGrant 後輸入，查鏈上授權範圍並觸發 inject
     */
    api.registerCommand({
      name: "getPermission",
      description: "Load on-chain permissions and projections",
      acceptsArgs: false,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleGetPermission } = await import("./src/permission-handler.js");
        return handleGetPermission(ctx.senderId, async (text: string) => {
          if (!ctx.senderId) return;
          const send = api.runtime?.channel?.telegram?.sendMessageTelegram;
          if (!send) return;
          await send(ctx.senderId, text, {
            ...(ctx.messageThreadId != null ? { messageThreadId: ctx.messageThreadId } : {}),
            ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
          });
        });
      },
    });

    /**
     * /acceptmission
     *
     * 使用者接受目前 active agent 的任務：
     * - 立即回覆「我已開始執行任務！」
     * - 3 秒後主動推播「我已經完成任務，是否確認提交？」
     */
    api.registerCommand({
      name: "acceptmission",
      description: "Accept current mission",
      acceptsArgs: false,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleAcceptMission } = await import("./src/mission-accept-handler.js");
        return handleAcceptMission({
          senderId: ctx.senderId,
          sendFollowUp: async (text: string) => {
            if (ctx.channel !== "telegram" || !ctx.senderId) return;
            const send = api.runtime?.channel?.telegram?.sendMessageTelegram;
            if (!send) return;
            await send(ctx.senderId, text, {
              ...(ctx.messageThreadId != null ? { messageThreadId: ctx.messageThreadId } : {}),
              ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
            });
          },
        });
      },
    });

    /**
     * /missionComplete
     *
     * 使用者提交任務：
     * - 1 秒後推播「恭喜任務通過審核，USDT 轉帳中」
     * - 呼叫 backend 執行 USDT 轉帳
     * - 完成後推播「恭喜，USDT 已轉帳至agent錢包」
     */
    api.registerCommand({
      name: "missionComplete",
      description: "Submit mission and settle reward",
      acceptsArgs: false,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleMissionComplete } = await import("./src/mission-complete-handler.js");
        return handleMissionComplete({
          senderId: ctx.senderId,
          sendFollowUp: async (text: string) => {
            if (ctx.channel !== "telegram" || !ctx.senderId) return;
            const send = api.runtime?.channel?.telegram?.sendMessageTelegram;
            if (!send) return;
            await send(ctx.senderId, text, {
              ...(ctx.messageThreadId != null ? { messageThreadId: ctx.messageThreadId } : {}),
              ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
            });
          },
        });
      },
    });

    /**
     * /lobsters
     *
     * 列出使用者所有已綁定龍蝦及目前 active 狀態。
     */
    api.registerCommand({
      name: "lobsters",
      description: "List all bound agents",
      acceptsArgs: false,
      requireAuth: false,
      handler: async (ctx) => {
        const { handleLobsters } = await import("./src/lobsters-handler.js");
        return handleLobsters(ctx.senderId);
      },
    });

    // =========================================================================
    // before_agent_start hook
    //
    // 每次 Pi agent 啟動前，依 senderId 找到 active agentId，
    // 讀取對應 workspace 的 soul/skill md，注入到 prompt context。
    // =========================================================================
    api.on("before_agent_start", async (_event, ctx) => {
      const senderId = ctx.from;
      if (!senderId) return;

      const { getActiveAgentId } = await import("./src/active-map.js");
      const agentId = await getActiveAgentId(senderId);
      if (!agentId) return;

      const { resolveWorkspaceDirForAgent } = await import("./src/workspace-dir.js");
      const workspaceDir = resolveWorkspaceDirForAgent(agentId);

      // Lazy inject：workspace 無 md 檔時嘗試 inject（用戶可能已完成 bindAndGrant）
      const fs = await import("node:fs/promises");
      let hasMdFile = false;
      try {
        const files = await fs.readdir(workspaceDir);
        hasMdFile = files.some((f) => f.startsWith(".soul.") && f.endsWith(".md"));
      } catch {
        // workspace 目錄不存在，視為無 md 檔
      }

      if (!hasMdFile) {
        try {
          const { inject } = await import("./src/inject.js");
          await inject(agentId, workspaceDir);
        } catch {
          // permission 尚未 grant，靜默略過
        }
      }

      const { buildAgentPersonaOverride } = await import("./src/context-builder.js");
      const systemPrompt = await buildAgentPersonaOverride(agentId);
      if (!systemPrompt) return;

      return { systemPrompt };
    });

    // =========================================================================
    // CLI
    // =========================================================================
    api.registerCli(
      ({ program }) => {
        const cmd = program
          .command("twin-matrix")
          .description("Twin Matrix soul injection commands");

        /**
         * inject --agent <agentId>
         */
        cmd
          .command("inject")
          .description("查鏈上授權並注入最新 Twin Matrix 投影")
          .requiredOption("--agent <agentId>", "Agent ID（龍蝦身份）")
          .option("--workspace <dir>", "Workspace 目錄（預設依 agentId 自動決定）")
          .action(async (opts: { agent: string; workspace?: string }) => {
            const { inject } = await import("./src/inject.js");
            const { resolveWorkspaceDirForAgent } = await import("./src/workspace-dir.js");
            const workspaceDir = opts.workspace ?? resolveWorkspaceDirForAgent(opts.agent);
            console.log(`Injecting Twin Matrix → ${workspaceDir} (agentId: ${opts.agent})`);
            try {
              const result = await inject(opts.agent, workspaceDir);
              console.log(`✓ Injected scopes: ${result.injected.join(", ") || "(none)"}`);
              if (result.denied.length > 0) {
                console.log(`  Denied/missing scopes: ${result.denied.join(", ")}`);
              }
              console.log(`  agentId:  ${result.agentId}`);
              console.log(`  owner:    ${result.owner}`);
              console.log(`  expiry:   ${result.expiry}`);
              console.log(`  audit versionId: ${result.auditVersionId}`);
            } catch (err) {
              console.error(`✗ Inject failed: ${err instanceof Error ? err.message : String(err)}`);
              process.exitCode = 1;
            }
          });

        /**
         * status [--agent <agentId>]
         */
        cmd
          .command("status")
          .description("查看目前 inject 狀態")
          .option("--agent <agentId>", "Agent ID（若省略，使用預設 workspace）")
          .option("--workspace <dir>", "Workspace 目錄")
          .action(async (opts: { agent?: string; workspace?: string }) => {
            const { loadState } = await import("./src/state.js");
            const { resolveWorkspaceDirForAgent, resolveWorkspaceDir } =
              await import("./src/workspace-dir.js");
            const workspaceDir =
              opts.workspace ??
              (opts.agent ? resolveWorkspaceDirForAgent(opts.agent) : resolveWorkspaceDir());
            const state = await loadState(workspaceDir);
            if (!state.lastInject) {
              console.log(
                "No inject state found. Run `twin-matrix inject --agent <AGENT_ID>` first.",
              );
              return;
            }
            const s = state.lastInject;
            console.log("Twin Matrix Inject State:");
            console.log(`  agentId:          ${s.agentId}`);
            console.log(`  owner:            ${s.owner}`);
            console.log(`  permissionVer:    ${s.permissionVersion}`);
            console.log(`  injectedScopes:   ${s.injectedScopes.join(", ")}`);
            console.log(`  injectedAt:       ${s.injectedAt}`);
            console.log(`  expiry:           ${s.expiry}`);
            console.log(`  auditVersionId:   ${s.auditVersionId ?? "-"}`);
            const expired = new Date(s.expiry) < new Date();
            console.log(`  status:           ${expired ? "EXPIRED" : "active"}`);
          });

        /**
         * reset --scope style,food [--agent <agentId>]
         */
        cmd
          .command("reset")
          .description("清除指定 scope 的 soul/skill md 檔")
          .requiredOption("--scope <scopes>", "逗號分隔 scope（e.g. style,food）")
          .option("--agent <agentId>", "Agent ID")
          .option("--workspace <dir>", "Workspace 目錄")
          .action(async (opts: { scope: string; agent?: string; workspace?: string }) => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            const { SCOPE_MAP } = await import("./src/scope-map.js");
            const { resolveWorkspaceDirForAgent, resolveWorkspaceDir } =
              await import("./src/workspace-dir.js");
            const workspaceDir =
              opts.workspace ??
              (opts.agent ? resolveWorkspaceDirForAgent(opts.agent) : resolveWorkspaceDir());
            const scopes = opts.scope.split(",").map((s) => s.trim());
            const removed: string[] = [];
            const missing: string[] = [];
            for (const scope of scopes) {
              const files = SCOPE_MAP[scope];
              if (!files) {
                console.warn(`Unknown scope: ${scope}`);
                continue;
              }
              for (const filename of [files.soul, files.skill]) {
                const filePath = path.join(workspaceDir, filename);
                try {
                  await fs.unlink(filePath);
                  removed.push(filename);
                } catch {
                  missing.push(filename);
                }
              }
            }
            if (removed.length > 0) console.log(`Removed: ${removed.join(", ")}`);
            if (missing.length > 0) console.log(`Not found: ${missing.join(", ")}`);
          });
      },
      { commands: ["twin-matrix"] },
    );
  },
};

export default twinMatrixPlugin;
