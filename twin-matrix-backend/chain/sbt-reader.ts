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
  /** 展開後的 64 維陣列（index 對應位置填入 value，其餘為 0） */
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

/** indices + values 稀疏格式展開成 64 維陣列（uint8 值，未填處為 0） */
function expandSparseToRaw(indices: number[], values: number[], size = 64): number[] {
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
    raw: new Array(64).fill(0),
  };
}

function mockPermission(agentAddress: string): PermissionData {
  return {
    valid: true,
    owner: "0xMockOwner",
    agentAddress,
    scopeMask: BigInt(0b1111111), // 所有 7 個 domain 皆開啟
    expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    permissionVersion: 1,
  };
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
  const contract = new Contract(getSbtContractAddress(), SBT_ABI, agentWallet);

  const result = await contract.getAuthorizedLatestValues(tokenId) as {
    indices: bigint[];
    values: bigint[];
    version: bigint;
    digest: string;
    blockNumber: bigint;
  };

  const indices = result.indices.map(Number);
  const values = result.values.map(Number);

  return {
    indices,
    values,
    version: Number(result.version),
    digest: result.digest,
    blockNumber: result.blockNumber,
    raw: expandSparseToRaw(indices, values),
  };
}

/**
 * 讀取某龍蝦的授權狀態
 *
 * TODO: getPermission 的函式名稱與 ABI 待合約工程師確認
 */
export async function getPermission(agentAddress: string): Promise<PermissionData> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] getPermission(${agentAddress})`);
    return mockPermission(agentAddress);
  }

  const contract = new Contract(getPermissionContractAddress(), SBT_ABI, getProvider());

  // TODO: 待確認 ABI
  // const result = await contract.getPermission(agentAddress);
  // return parsePermissionResult(agentAddress, result);

  throw new Error("getPermission: function name not yet confirmed with contract engineer.");
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
