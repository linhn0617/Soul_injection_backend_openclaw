/**
 * Grant Checker (V2)
 *
 * V2 設計：
 * - 以 agentId 查詢鏈上 permission（PoC: 查 backend /v1/permission/resolve）
 * - 不再以 token 字串作為授權單位
 * - 回傳不含 versionId（非授權語義）
 */

import { getBackendUrl } from "./runtime.js";

export type PermissionResolution = {
  valid: boolean;
  owner?: string;
  agentId?: string;
  scope?: string[];
  expiry?: string;
  permissionVersion?: number;
  reason?: string;
};

/**
 * 查詢 agentId 的鏈上授權狀態
 * PoC: 呼叫 GET /v1/permission/resolve?agentId=
 */
export async function resolvePermission(agentId: string): Promise<PermissionResolution> {
  const url = `${getBackendUrl()}/v1/permission/resolve?agentId=${encodeURIComponent(agentId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve permission: HTTP ${res.status}`);
  }
  return res.json() as Promise<PermissionResolution>;
}
