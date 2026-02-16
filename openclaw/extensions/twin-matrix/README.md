# extensions/twin-matrix

OpenClaw 擴充功能，實作 Twin Matrix Soul-to-Agent Injection。

使用者在 Web 前端完成分身塑造並授權後，此 Extension 負責：

1. **deep link 接收**：使用者點擊 Web 端產生的 Telegram deep link，觸發 `/start <payload>`
2. **龍蝦綁定**：將 Telegram 使用者 ID 與 agentId 綁定（呼叫 backend `/v1/agent/bind`）
3. **投影注入**：從 backend 取得授權 scope 的投影資料，寫入 `.soul.{domain}.md` / `.skill.{domain}.md`
4. **多龍蝦切換**：`/switch` 切換 active 龍蝦；`/lobsters` 列出所有已綁定龍蝦
5. **context 注入**：每次 Pi agent 啟動前，讀取 active 龍蝦的 soul/skill md 注入 system prompt

## 前置條件

- `twin-matrix-backend` 服務需在 `http://localhost:3400` 運行（或設定 `TWIN_MATRIX_BACKEND_URL`）
- OpenClaw core 版本需包含 `PluginHookAgentContext.from` 欄位（senderId 傳遞）

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `TWIN_MATRIX_BACKEND_URL` | `http://localhost:3400` | Twin Matrix 後端服務位址 |

## 待實作（開會後）

- [ ] ERC8004 鏈上自我註冊（`start-handler.ts` 內，呼叫 bnbagent SDK）
- [ ] 龍蝦完成 ERC8004 後，將 `agentAddress` 回報至後端
- [ ] `getPermission(agentAddress)` ABI 確認後，接通真實鏈上授權查詢

## Plugin 設定（openclaw.plugin.json）

```json
{
  "id": "twin-matrix",
  "kind": "utility",
  "description": "Twin Matrix Soul-to-Agent Injection",
  "configSchema": {
    "properties": {
      "backendUrl": {
        "type": "string",
        "description": "Twin Matrix backend URL (default: http://localhost:3400)"
      }
    }
  }
}
```

也可透過環境變數 `TWIN_MATRIX_BACKEND_URL` 覆蓋 backend URL。

## Telegram 指令

```
/start <payload>   deep link 觸發：綁定龍蝦 + 注入投影 + 歡迎訊息
/switch <n|name>   切換 active 龍蝦（依編號或 agentType 名稱模糊比對）
/lobsters          列出所有已綁定龍蝦及目前 active 狀態
```

### 多龍蝦切換流程

1. 使用者可在 Web 端建立多個龍蝦（各有不同 agentType，例如 fashion / sport / foodie）
2. 每個龍蝦透過獨立 deep link 與 Telegram 綁定
3. `/lobsters` 顯示所有已綁定龍蝦清單與目前 active 龍蝦
4. `/switch 2` 或 `/switch fashion` 切換 active 龍蝦
5. 切換後，`before_agent_start` hook 自動切換對應龍蝦的 soul/skill context

## CLI 指令（終端機）

```bash
# 查鏈上授權並注入最新投影
pnpm openclaw twin-matrix inject --agent <agentId>
pnpm openclaw twin-matrix inject --agent <agentId> --workspace /path/to/workspace

# 查看目前 inject 狀態
pnpm openclaw twin-matrix status
pnpm openclaw twin-matrix status --agent <agentId>

# 清除指定 scope 的 soul/skill md 檔
pnpm openclaw twin-matrix reset --scope style,food
pnpm openclaw twin-matrix reset --scope style --agent <agentId>
```

## 目錄結構

```
extensions/twin-matrix/
├── index.ts                  # Plugin 主入口（註冊指令、hooks、CLI）
├── openclaw.plugin.json      # Plugin 宣告
├── package.json
└── src/
    ├── runtime.ts            # Backend URL 設定（singleton）
    ├── active-map.ts         # telegramUserId → agentId 對應表（本地 JSON）
    ├── context-builder.ts    # 讀取 soul/skill md → prependContext 字串
    ├── grant-checker.ts      # 呼叫 /v1/permission/resolve 驗證龍蝦授權
    ├── projection-client.ts  # 呼叫 /v1/projection 取得投影資料
    ├── md-injector.ts        # 寫入 .soul.{domain}.md / .skill.{domain}.md
    ├── inject.ts             # inject(agentId, workspaceDir) 主流程
    ├── scope-map.ts          # scope → { soul, skill } 檔名對應
    ├── state.ts              # 讀寫 state.json（inject 狀態記錄）
    ├── start-handler.ts      # /start 指令邏輯
    ├── switch-handler.ts     # /switch 指令邏輯
    ├── lobsters-handler.ts   # /lobsters 指令邏輯
    └── workspace-dir.ts      # workspace 路徑解析（agentId → 隔離目錄）
```

## Workspace 隔離

每個龍蝦有獨立的 workspace 目錄：

```
~/.openclaw/
├── workspace/                  # 預設 workspace
├── workspace-{agentId}/        # 龍蝦 A 的 workspace
│   ├── .soul.style.md
│   ├── .skill.style.md
│   ├── MEMORY.md               # 包含 Twin Matrix 摘要 (<!-- twin-matrix:start --> 區塊)
│   └── state.json              # inject 狀態記錄
└── workspace-{agentId2}/       # 龍蝦 B 的 workspace
    └── ...
```

active-map（`~/.openclaw/workspace/.twin-matrix-active.json`）記錄每個 Telegram 使用者目前的 active 龍蝦：

```json
{
  "tg_123456": "agent_abc123"
}
```

## inject 主流程

```
inject(agentId, workspaceDir)
  ↓
1. /v1/permission/resolve?agentId=  → 取得 owner、scope、expiry
2. /v1/projection?userId=&scope=    → 取得各 domain 投影資料
3. 寫入 .soul.{domain}.md + .skill.{domain}.md（每個授權 scope）
4. 更新 MEMORY.md（PoC bootstrap 摘要）
5. 寫入 state.json（audit 記錄）
```

### 單向投影原則

- Agent **只讀** `.soul.*.md` / `.skill.*.md`，**不得回寫或修改**
- inject 時若某 scope 未被授權，跳過不寫入（記錄在 `denied` 欄位）
- `versionId` 僅供 audit 查詢，不作為授權限制（龍蝦永遠讀取最新狀態）

## Soul/Skill md 格式範例

`.soul.style.md`：
```markdown
---
agentId: agent_abc123
owner: u123
checksum: sha256...
scope: style
expiry: 2026-03-12T00:00:00Z
updatedAt: 2026-02-12T13:00:00Z
---

# Soul Matrix — Style

visibility_preference: 0.35
identity_expression: 0.72
contextual_adaptability: 0.60
```

`.skill.style.md`：
```markdown
---
agentId: agent_abc123
checksum: sha256...
scope: style
expiry: 2026-03-12T00:00:00Z
---

# Skill Matrix — Style

## Brand Affinity
- Uniqlo: 0.85
- COS: 0.78
- Zara: 0.45

style_consistency: 0.70
experimentation_level: 0.40
```

## 七大生活領域 Scope

| Scope | Soul 投影檔 | Skill 投影檔 |
|-------|------------|-------------|
| `style` | `.soul.style.md` | `.skill.style.md` |
| `food` | `.soul.food.md` | `.skill.food.md` |
| `home` | `.soul.home.md` | `.skill.home.md` |
| `mobility` | `.soul.mobility.md` | `.skill.mobility.md` |
| `entertainment` | `.soul.entertainment.md` | `.skill.entertainment.md` |
| `learning` | `.soul.learning.md` | `.skill.learning.md` |
| `beauty` | `.soul.beauty.md` | `.skill.beauty.md` |
