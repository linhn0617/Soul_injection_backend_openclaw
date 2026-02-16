/**
 * Projection Client (V2)
 *
 * V2 設計：
 * - 不傳 versionId（latest 模型，backend 自動讀最新）
 * - 回傳的 versionId / checksum 僅作 audit 用途
 */

import { getBackendUrl } from "./runtime.js";

export type DomainProjection = {
  soul: Record<string, unknown>;
  skill: Record<string, unknown>;
};

export type ProjectionResponse = {
  userId: string;
  versionId: string;   // audit 標記，非授權語義
  checksum: string;    // audit 標記，非授權語義
  projections: Record<string, DomainProjection>;
};

/**
 * 向 Backend 取得最新 projection（不綁定 versionId）
 * PoC: 呼叫 GET /v1/projection?userId=&scope=
 */
export async function fetchProjection(
  userId: string,
  scopes: string[],
): Promise<ProjectionResponse> {
  const params = new URLSearchParams({
    userId,
    scope: scopes.join(","),
  });
  const url = `${getBackendUrl()}/v1/projection?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch projection: HTTP ${res.status}`);
  }
  return res.json() as Promise<ProjectionResponse>;
}
