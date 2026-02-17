# twin-matrix-backend

Twin Matrix 後端服務。負責龍蝦（Agent）的生命週期管理、鏈上授權查詢、以及 Matrix 投影計算，供 OpenClaw `extensions/twin-matrix` 呼叫。

## 架構定位

```
前端         計算 Twin Matrix 分數 → 直接寫 SBT 合約
前端         MetaMask 簽 bindAndGrant → 直接寫鏈上授權
後端（本服務） 龍蝦管理 + 鏈上資料查詢 + 投影計算
OpenClaw     inject 時查後端取得投影 → 寫入 soul/skill md
```

**後端不儲存使用者身份資料，不處理授權簽署，只做：**
1. 龍蝦生命週期（register / bind / resolve / list）
2. 鏈上授權查詢（`GET /v1/permission/resolve` → 查 SBT 合約）
3. Matrix 投影計算（從鏈上讀 matrix → 轉換為 soul/skill 語義格式）

---

## 啟動

```bash
npm install
cp .env.example .env   # 填入實際環境變數
npx tsx index.ts
```

服務啟動於 `http://localhost:3400`

健康確認：`GET /health` → `{ status: "ok", service: "twin-matrix-backend", version: "v2" }`

---

## 環境變數

複製 `.env.example` 為 `.env` 並填入實際值，詳細說明見 `.env.example`。

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `TELEGRAM_BOT_USERNAME` | — | Telegram bot username（不含 @） |
| `CHAIN_ENABLED` | `false` | `false` = mock 模式；`true` = 實際查 BNB Chain |
| `RPC_URL` | — | BNB Testnet RPC endpoint |
| `TWIN_MATRIX_SBT_ADDRESS` | testnet 地址 | TwinMatrixSBT 合約地址 |
| `AGENT_REGISTRY_CONTRACT_ADDRESS` | — | ERC8004 AgentRegistry（待確認） |
| `PERMISSION_CONTRACT_ADDRESS` | fallback SBT | Permission 合約（可與 SBT 相同） |
| `OPERATOR_PRIVATE_KEY` | — | Operator 錢包私鑰（備用） |
| `PORT` | `3400` | 服務監聽 port |
| `FRONTEND_URL` | localhost any port | CORS 允許的前端來源 |

---

## API 端點

### Agent（龍蝦管理）

```
POST /v1/agent/register
  Body: { ownerAddress, tokenId? }
  → { agentId, deepLink }
  說明：Web 端建立龍蝦，產生 agentId 與 Telegram deep link。
        龍蝦錢包與 ERC8004 鏈上註冊由龍蝦自己在 Telegram 完成。

POST /v1/agent/bind
  Body: { payload, telegramUserId }
  → { agentId, owner, agentType, telegramUserId, status }
  說明：Telegram /start 後回呼，綁定 telegramUserId ↔ agentId，
        同時觸發 ERC8004 鏈上註冊（龍蝦自己跑）。

GET /v1/agent/resolve?agentId=
  → AgentRecord
  說明：查詢龍蝦完整資訊。前端 polling 此端點直到 agentAddress 出現，
        確認 ERC8004 完成後再引導使用者簽 bindAndGrant。

GET /v1/agent/list?owner=  |  ?telegramUserId=
  → { agents: AgentRecord[] }
```

**AgentRecord 格式**

```json
{
  "agentId": "agent_abc123",
  "owner": "0xWalletAddress",
  "tokenId": "42",
  "agentType": "fashion",
  "agentAddress": "0xLobsterWallet",
  "encryptedKey": "...",
  "telegramPayload": "base64url...",
  "telegramUserId": "tg_987654",
  "status": "pending | active | revoked",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

### Permission（授權查詢）

```
GET /v1/permission/resolve?agentId=
  → { valid, owner, agentId, agentAddress, scope, expiry, permissionVersion }
  說明：查詢龍蝦的鏈上授權狀態。
        CHAIN_ENABLED=false → mock 資料
        CHAIN_ENABLED=true  → 查 SBT 合約 getPermission(agentAddress)
        scopeMask（uint256 bitmask）自動轉換為 scope 名稱陣列。
```

> **已移除**：`POST /v1/permission/grant`
> 授權由使用者直接在前端用 MetaMask 簽 `bindAndGrant` 交易到 SBT 合約。

---

### Projection（投影計算）

```
GET /v1/projection?userId=&scope=style,food
  → { userId, versionId, checksum, projections: { [domain]: { soul, skill } } }
  說明：從 SBT 合約讀取 matrix，計算各 domain 的語義投影，
        供 OpenClaw inject 用。
        優先讀取 data/projections/ 快取，無快取則從鏈上即時計算。
```

> **TODO（開會後）**：`userId` 改為 `ownerAddress`，讀取來源從本地 JSON 改為鏈上 `getMatrix(ownerAddress)`。

---

### Alignment（品牌對齊，Molt Road 整合用）

```
POST /v1/match/alignment
  Body: { agentId, brandAgentId, brandMatrix }
  → { alignmentScore, soulContrib, skillContrib, reasons[] }
  說明：計算龍蝦與品牌的偏好相似度，供 Molt Road bounty 匹配使用。
```

---

## 流程說明

### 流程 B：啟動龍蝦

```
[Web]
1. POST /v1/agent/register { owner, tokenId, agentType }
   ← { agentId, deepLink }

2. 使用者點 deepLink → 跳轉 Telegram

[Telegram]
3. /start → POST /v1/agent/bind
   → 龍蝦自己產錢包 + 跑 ERC8004 → agentAddress 寫入 record
   → 龍蝦傳訊息：「請回到網站完成授權」（附授權連結）

[Web]
4. Polling GET /v1/agent/resolve?agentId= 直到 agentAddress 出現

5. MetaMask 簽 bindAndGrant(agentAddress, scopeMask, expiry) → 鏈上

[Telegram]
6. 使用者傳第一則訊息 → lazy inject → 查鏈上 permission → 個人化回應 ✅
```

### 流程 C：調整授權範圍（不需後端）

```
前端直接讀 SBT 合約取得龍蝦列表
→ MetaMask 簽 updateGrant(agentAddress, scopeMask, expiry) → 鏈上
→ 龍蝦下次 inject 自動偵測 permissionVersion 更新並重新載入
```

---

## Chain Layer

```
chain/
├── index.ts          # 統一 re-export
├── client.ts         # ethers.js provider + 錢包管理
├── contracts.ts      # 合約地址 + ABI（TODO: 開會後填入）
├── sbt-reader.ts     # getMatrix / getPermission / getAgentsByOwner
└── agent-registry.ts # registerAgentOnChain（TODO: bnbagent SDK）
```

`CHAIN_ENABLED=false` 時全部 mock，`CHAIN_ENABLED=true` 時實際呼叫 BNB Chain。

**Scope bitmask 對應**（TODO: 開會後確認）

| Bit | Domain |
|-----|--------|
| 0 | style |
| 1 | food |
| 2 | home |
| 3 | mobility |
| 4 | entertainment |
| 5 | learning |
| 6 | beauty |

---

## 資料結構

```
data/
├── agents/
│   └── {agentId}.json     # 龍蝦資料（含 agentAddress、encryptedKey）
└── projections/           # 投影快取（選配）
    └── {owner}_{domain}.json
```

> `data/matrices/` 和 `data/grants/` 已移除。
> Matrix 資料在 SBT 合約上，授權在鏈上 `bindAndGrant`。

---

## 技術棧

- **Runtime**：Node.js + tsx
- **框架**：Express.js
- **鏈上**：ethers.js v6
- **環境**：dotenv
