/**
 * inject() 主流程 (V2)
 *
 * V2 流程：
 * 1. 以 agentId 查鏈上 permission（resolvePermission）
 * 2. 從 permission 取得 owner（→ 對應 userId）
 * 3. 向 backend 取得最新 projection（fetchProjection，不傳 versionId）
 * 4. 對每個已授權 scope 寫入 .soul.{domain}.md / .skill.{domain}.md
 * 5. PoC bootstrap：更新 MEMORY.md 摘要
 * 6. 更新 state.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { DomainProjection } from "./projection-client.js";
import { resolvePermission } from "./grant-checker.js";
import { injectDomainToMd } from "./md-injector.js";
import { fetchProjection } from "./projection-client.js";
import { SCOPE_MAP } from "./scope-map.js";
import { loadState, saveState } from "./state.js";

export type InjectResult = {
  agentId: string;
  owner: string;
  injected: string[];
  denied: string[];
  expiry: string;
  // audit
  auditVersionId: string;
};

/** PoC bootstrap: 更新 MEMORY.md 摘要 */
async function appendToMemory(
  workspaceDir: string,
  agentId: string,
  owner: string,
  expiry: string,
  injectedScopes: string[],
  projections: Record<string, DomainProjection>,
): Promise<void> {
  const memoryPath = path.join(workspaceDir, "MEMORY.md");

  const lines: string[] = [
    "",
    `<!-- twin-matrix:start agentId=${agentId} -->`,
    `## Twin Matrix 分身狀態 (agent: ${agentId} · owner: ${owner} · expires ${expiry})`,
    "",
    "已注入的領域投影：",
  ];

  for (const scope of injectedScopes) {
    const proj = projections[scope];
    if (!proj) continue;
    const domainLabel = scope.charAt(0).toUpperCase() + scope.slice(1);
    lines.push("", `### ${domainLabel}`);

    const soulEntries = Object.entries(proj.soul)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`- Soul: ${soulEntries}`);

    const skill = proj.skill as Record<string, unknown>;
    const brandMatrix = skill.brand_affinity_matrix as Record<string, number> | undefined;
    if (brandMatrix) {
      const top = Object.entries(brandMatrix)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([brand, score]) => `${brand}(${score})`)
        .join(", ");
      lines.push(`- Top brands: ${top}`);
    }

    lines.push(`- 詳細投影：\`.soul.${scope}.md\` / \`.skill.${scope}.md\``);
  }

  lines.push("", "<!-- twin-matrix:end -->");

  const block = lines.join("\n");

  let existing = "";
  try {
    existing = await fs.readFile(memoryPath, "utf-8");
  } catch {
    // 檔案不存在
  }

  const cleaned = existing.replace(
    /\n?<!-- twin-matrix:start[^>]*-->[\s\S]*?<!-- twin-matrix:end -->/g,
    "",
  );

  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(memoryPath, cleaned + block, "utf-8");
}

export async function inject(agentId: string, workspaceDir: string): Promise<InjectResult> {
  // Step 1: 查鏈上 permission（PoC: 查 backend）
  const permission = await resolvePermission(agentId);
  if (!permission.valid) {
    throw new Error(`Permission invalid for agentId=${agentId}: ${permission.reason ?? "unknown"}`);
  }

  const { owner, scope: authorizedScopes, expiry, permissionVersion } = permission;

  if (!owner || !authorizedScopes?.length || !expiry) {
    throw new Error("Incomplete permission data");
  }

  // Filter to known scopes
  const knownScopes = authorizedScopes.filter((s) => SCOPE_MAP[s] !== undefined);
  const unknownScopes = authorizedScopes.filter((s) => SCOPE_MAP[s] === undefined);

  // Step 3: 取得最新 projection（不傳 versionId，以 agentId 查詢）
  const projectionResponse = await fetchProjection(agentId, knownScopes);

  // Step 4: 寫入 md 檔
  const injected: string[] = [];
  const denied: string[] = [...unknownScopes];

  for (const scope of knownScopes) {
    const projection = projectionResponse.projections[scope];
    if (!projection) {
      denied.push(scope);
      continue;
    }

    await injectDomainToMd(workspaceDir, scope, projection, {
      versionId: projectionResponse.versionId, // audit 用途
      checksum: projectionResponse.checksum,
      expiry,
    });
    injected.push(scope);
  }

  // Step 5: PoC bootstrap — 更新 MEMORY.md
  if (injected.length > 0) {
    await appendToMemory(
      workspaceDir,
      agentId,
      owner,
      expiry,
      injected,
      projectionResponse.projections,
    );
  }

  // Step 6: 更新 state
  const state = await loadState(workspaceDir);
  state.lastInject = {
    agentId,
    owner,
    userId: agentId,
    permissionVersion: permissionVersion ?? 0,
    injectedScopes: injected,
    deniedScopes: denied,
    injectedAt: new Date().toISOString(),
    expiry,
    auditVersionId: projectionResponse.versionId,
    auditChecksum: projectionResponse.checksum,
  };
  await saveState(workspaceDir, state);

  return {
    agentId,
    owner,
    injected,
    denied,
    expiry,
    auditVersionId: projectionResponse.versionId,
  };
}
