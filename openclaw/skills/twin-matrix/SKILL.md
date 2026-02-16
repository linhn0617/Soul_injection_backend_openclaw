---
name: twin-matrix
description: "Access user's Twin Matrix soul and skill projections from .soul.*.md and .skill.*.md files"
metadata:
  openclaw:
    emoji: "🧬"
---

# Twin Matrix

使用者的個人化分身狀態儲存於工作區的狀態投影文件中（需先完成授權 inject）。

**Soul Matrix 投影**（感性風格）：

- `.soul.style.md` — 穿搭風格與自我表達取向
- `.soul.food.md` — 飲食感性偏好
- `.soul.home.md` — 居家美學取向
- `.soul.mobility.md` — 移動方式感性偏好
- `.soul.entertainment.md` — 娛樂內容感性偏好
- `.soul.learning.md` — 學習風格取向
- `.soul.beauty.md` — 美妝保養感性取向

**Skill Matrix 投影**（品牌偏好）：

- `.skill.style.md` — 服飾品牌熟悉度與偏好強度
- `.skill.food.md` — 餐飲品牌偏好
- `.skill.home.md` — 居家品牌偏好
- `.skill.mobility.md` — 交通品牌偏好
- `.skill.entertainment.md` — 娛樂平台偏好
- `.skill.learning.md` — 學習平台偏好
- `.skill.beauty.md` — 美妝品牌偏好

**使用規則**：

- 這些檔案為 Twin Matrix 的唯讀投影，不得修改或回寫
- 回答個人化問題時，優先讀取對應 soul + skill 檔作為依據
- 若檔案不存在，告知使用者需先執行 `pnpm openclaw twin-matrix inject --token <TOKEN>`
- 使用前確認 frontmatter 中的 `expiry` 是否有效（若已過期請通知使用者重新 inject）
- 數值範圍 0.0～1.0，越高代表該特質傾向越強

**個人化回應範例**：

- 穿搭推薦：讀取 `.soul.style.md` + `.skill.style.md`，結合 identity_expression 與 brand_affinity_matrix 給出建議
- 餐廳推薦：讀取 `.soul.food.md` + `.skill.food.md`，結合 social_dining 與品牌偏好
- 居家佈置：讀取 `.soul.home.md` + `.skill.home.md`，結合 aesthetic_minimalism 與 IKEA/Muji 偏好
