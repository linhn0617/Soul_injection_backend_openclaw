import { config } from "dotenv";
config();

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPermissionRouter } from "./routes/permission.js";
import { createProjectionRouter } from "./routes/projection.js";
import { createAlignmentRouter } from "./routes/alignment.js";
import { createAgentRouter } from "./routes/agent.js";
import { createMissionRouter } from "./routes/mission.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "data");

const app = express();

// CORS：生產環境請設定 FRONTEND_URL（逗號分隔多個來源）
// 未設定時僅允許 localhost（本機開發用）
const corsOrigin = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((u) => u.trim())
  : /^http:\/\/localhost:\d+$/;
app.use(cors({ origin: corsOrigin }));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "twin-matrix-backend", version: "v2" });
});

// Routes
app.use(createAgentRouter());       // /v1/agent/*
app.use(createPermissionRouter());  // /v1/permission/resolve
app.use(createProjectionRouter());  // /v1/projection
app.use(createAlignmentRouter());   // /v1/match/*
app.use(createMissionRouter());     // /v1/mission/*

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3400;
app.listen(PORT, () => {
  console.log(`Twin Matrix Backend running on http://localhost:${PORT}`);
});

export default app;
