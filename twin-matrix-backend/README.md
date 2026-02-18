# twin-matrix-backend

Twin Matrix 後端服務。負責 AI Agent 的生命週期管理、鏈上授權查詢、以及 Matrix 投影計算，供 OpenClaw extension 呼叫。

## 架構定位

```
前端（Web）       計算 Twin Matrix 分數 → 寫入 SBT 合約
                  使用者簽署授權交易 → 寫入鏈上授權
後端（本服務）     Agent 管理 + 鏈上資料查詢 + 投影計算
OpenClaw          inject 時向後端取得投影 → 注入個人化 soul/skill
```

後端不儲存使用者身份資料，不處理授權簽署，職責為：
1. Agent 生命週期管理（註冊、綁定、查詢）
2. 鏈上授權狀態查詢（讀取 SBT 合約）
3. Matrix 投影計算（鏈上 256 維向量 → 語義格式轉換）
4. Agent 與品牌的偏好對齊計算

---

## 啟動

```bash
npm install
cp .env.example .env   # 填入實際環境變數
npx tsx index.ts
```

服務預設啟動於 `http://localhost:3400`。環境變數說明見 `.env.example`。

---

## 流程概覽

### 啟動 Agent

```
[Web]
1. 建立 Agent → 取得 agentId + Telegram deep link
2. 使用者點 deep link → 跳轉 Telegram

[Telegram]
3. /start → 綁定身份 + ERC8004 鏈上註冊

[Web]
4. 確認鏈上註冊完成 → 使用者簽署授權交易（bindAndGrant）

[Telegram]
5. 使用者傳訊息 → lazy inject → 查鏈上授權 → 個人化回應
```

### 調整授權範圍

使用者直接透過前端簽署鏈上交易更新授權，不需經過後端。
Agent 下次 inject 時自動偵測授權版本變更並重新載入。

---

## 技術棧

- **Runtime**：Node.js + tsx
- **框架**：Express.js
- **鏈上互動**：ethers.js v6
- **鏈**：BNB Chain Testnet
- **合約標準**：ERC8004（Agent Registry）、TwinMatrixSBT
