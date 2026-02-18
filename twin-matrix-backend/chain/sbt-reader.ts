/**
 * SBT Contract Reader
 *
 * 所有對 SBT 合約的 eth_call（唯讀，免 gas）
 *
 * CHAIN_ENABLED=false 時回傳 mock 資料，供本機開發使用。
 *
 * 已確認的合約函式：
 *   tokenIdOf(address ownerAddress) → uint256
 *   getAuthorizedLatestValues(uint256 tokenId) → (bytes32, bytes32)
 *     ↑ 必須以授權龍蝦地址（agentAddress）為 from 呼叫，否則 revert
 *
 * 待確認：
 *   getPermission(address agentAddress) → (owner, scopeMask, expiry, permissionVersion)
 */

import { Contract } from "ethers";
import { getProvider, getAgentWallet, isChainEnabled } from "./client.js";
import { getSbtContractAddress, getPermissionContractAddress, SBT_ABI } from "./contracts.js";

// =========================================================================
// Types
// =========================================================================

export type MatrixData = {
  /** indices[i] → values[i] 的稀疏 matrix 格式（合約回傳） */
  indices: number[];
  values: number[];
  version: number;
  digest: string;
  blockNumber: bigint;
  /** 展開後的 256 維陣列（index 對應位置填入 value，其餘為 0） */
  raw: number[];
};

export type PermissionData = {
  valid: boolean;
  owner: string;
  agentAddress: string;
  scopeMask: bigint;
  expiry: string;         // ISO 8601
  permissionVersion?: number;
};

export type AgentOnChain = {
  agentAddress: string;
  owner: string;
  scopeMask: bigint;
  expiry: string;
};

// =========================================================================
// Helpers
// =========================================================================

/** indices + values 稀疏格式展開成 256 維陣列（uint8 值，未填處為 0） */
function expandSparseToRaw(indices: number[], values: number[], size = 256): number[] {
  const raw = new Array(size).fill(0);
  indices.forEach((idx, i) => {
    if (idx < size) raw[idx] = values[i] ?? 0;
  });
  return raw;
}

// =========================================================================
// Mock 資料（CHAIN_ENABLED=false 時使用）
// =========================================================================

function mockMatrix(): MatrixData {
  return {
    indices: [],
    values: [],
    version: 1,
    digest: "0x" + "00".repeat(32),
    blockNumber: BigInt(0),
    raw: new Array(256).fill(0),
  };
}

function mockPermission(agentAddress: string): PermissionData {
  return {
    valid: true,
    owner: "0xMockOwner",
    agentAddress,
    scopeMask: BigInt(8), // bit 3 = mobility only
    expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    permissionVersion: 1,
  };
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

function extractRevertSelector(err: unknown): string | undefined {
  const e = err as { data?: unknown; info?: { error?: { data?: unknown } } };
  const direct = typeof e?.data === "string" ? e.data : undefined;
  if (direct && /^0x[0-9a-fA-F]{8}/.test(direct)) {
    return direct.slice(0, 10).toLowerCase();
  }
  const nested = typeof e?.info?.error?.data === "string" ? e.info.error.data : undefined;
  if (nested && /^0x[0-9a-fA-F]{8}/.test(nested)) {
    return nested.slice(0, 10).toLowerCase();
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/data=\"(0x[0-9a-fA-F]{8})/);
  return m?.[1]?.toLowerCase();
}

function explainSelector(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  const table: Record<string, string> = {
    "0xff2ec039":
      "Agent is not authorized to read this SBT matrix (bindAndGrant missing, expired, or wrong caller).",
  };
  return table[selector];
}

// =========================================================================
// Read Functions
// =========================================================================

/**
 * tokenIdOf(ownerAddress) → tokenId
 *
 * 確認 selector：0x773c02d4
 */
export async function getTokenIdOf(ownerAddress: string): Promise<bigint> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] tokenIdOf(${ownerAddress}) → 1`);
    return BigInt(1);
  }

  const contract = new Contract(getSbtContractAddress(), SBT_ABI, getProvider());
  const tokenId = await contract.tokenIdOf(ownerAddress) as bigint;
  return tokenId;
}

/**
 * getAuthorizedLatestValues(tokenId) → MatrixData
 *
 * 確認 selector：0xcda0f320
 * 合約要求 msg.sender 必須是已授權的龍蝦地址。
 * 因此 eth_call 必須帶 from: agentAddress（使用龍蝦的 wallet）。
 *
 * @param tokenId     - SBT tokenId（由 tokenIdOf(ownerAddress) 取得）
 * @param agentPrivateKey - 龍蝦私鑰（用於設定 from，實際為 eth_call 不需簽名）
 */
export async function getAuthorizedLatestValues(
    tokenId: bigint,
    agentPrivateKey: string,
  ): Promise<MatrixData> {
    if (!isChainEnabled()) {
      console.log(`[chain:mock] getAuthorizedLatestValues(${tokenId})`);
      return mockMatrix();
    }

    const agentWallet = getAgentWallet(agentPrivateKey);
    console.info(
      `[chain] getAuthorizedLatestValues tokenId=${tokenId.toString()} caller=${agentWallet.address} sbt=${getSbtContractAddress()}`,
    );
    const contract = new Contract(getSbtContractAddress(), SBT_ABI, agentWallet);

    // ethers v6 Result 繼承 Array，result.values 會撞到 Array.prototype.values()
    // 因此改用 index 存取回傳值
    const result = await contract.getAuthorizedLatestValues(tokenId);

    const indices = Array.from(result[0] as bigint[]).map(Number);
    const values = Array.from(result[1] as bigint[]).map(Number);

    return {
      indices,
      values,
      version: Number(result[2]),
      digest: result[3] as string,
      blockNumber: result[4] as bigint,
      raw: expandSparseToRaw(indices, values),
    };
  }

/**
 * 讀取某龍蝦的授權狀態
 *
 * 透過 getAuthorizedLatestValues 判斷授權：成功 = 已授權，revert = 未授權。
 *
 * @param owner           - SBT 持有者地址
 * @param agentAddress    - 龍蝦地址
 * @param agentPrivateKey - 龍蝦私鑰（用於 from 呼叫）
 */
export async function getPermission(
  owner: string,
  agentAddress: string,
  agentPrivateKey: string,
): Promise<PermissionData> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] getPermission(${agentAddress})`);
    return mockPermission(agentAddress);
  }

  if (!agentPrivateKey?.trim()) {
    throw new Error("Agent private key is missing.");
  }

  // Guard: ensure the stored private key really belongs to this agentAddress.
  const caller = getAgentWallet(agentPrivateKey).address;
  console.info(
    `[chain] getPermission start owner=${owner} agentAddress=${agentAddress} caller=${caller}`,
  );
  if (normalizeAddress(caller) !== normalizeAddress(agentAddress)) {
    throw new Error(
      `Agent key mismatch: derived caller ${caller} does not match agentAddress ${agentAddress}.`,
    );
  }

  const tokenId = await getTokenIdOf(owner);

  // Best-effort diagnostic: binding list can be eventually consistent or vary by contract impl.
  // Do not hard-fail here; final truth is whether getAuthorizedLatestValues succeeds.
  let isBound: boolean | undefined;
  try {
    const boundAgents = await getBoundAgents(tokenId);
    isBound = boundAgents.some((a) => normalizeAddress(a) === normalizeAddress(agentAddress));
  } catch {
    isBound = undefined;
  }

  let matrix;
  try {
    matrix = await getAuthorizedLatestValues(tokenId, agentPrivateKey);
  } catch (err) {
    const selector = extractRevertSelector(err);
    const explanation = explainSelector(selector);
    if (explanation) {
      const bindingHint =
        isBound === false
          ? ` Binding list does not currently include agent ${agentAddress} under tokenId=${tokenId.toString()}.`
          : "";
      throw new Error(`${explanation}${selector ? ` [selector: ${selector}]` : ""}${bindingHint}`);
    }
    throw err;
  }
  // 成功 → 已授權
  console.info(
    `[chain] getPermission ok owner=${owner} agentAddress=${agentAddress} caller=${caller} tokenId=${tokenId.toString()} version=${matrix.version}`,
  );
  return {
    valid: true,
    owner,
    agentAddress,
    scopeMask: BigInt(8), // bit 3 = mobility only
    expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    permissionVersion: matrix.version,
  };
  // 若 getAuthorizedLatestValues throw → 由 permission.ts route 的 try/catch 捕捉 → valid: false
}

/**
 * getBoundAgents(tokenId) → address[]
 * 取得某 SBT tokenId 旗下所有已綁定龍蝦地址
 */
export async function getBoundAgents(tokenId: bigint): Promise<string[]> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] getBoundAgents(${tokenId})`);
    return [];
  }

  const contract = new Contract(getSbtContractAddress(), SBT_ABI, getProvider());
  const agents = await contract.getBoundAgents(tokenId) as string[];
  return agents;
}
