/**
 * Contract Addresses & ABIs
 *
 * 開會後填入以下內容：
 *   - 合約地址（BNB Testnet）
 *   - 合約 ABI（由合約工程師提供）
 *
 * TODO: 待確認
 *   - TWIN_MATRIX_SBT_ADDRESS
 *   - AGENT_REGISTRY_CONTRACT_ADDRESS（ERC8004）
 *   - ABI: getMatrix / getPermission / getAgentsByOwner
 */

// =========================================================================
// Contract Addresses
// =========================================================================

const SBT_CONTRACT_ADDRESS_DEFAULT = "0x12C61b22b397a6D72AD85f699fAf2D75f50D556C";

export function getSbtContractAddress(): string {
  return process.env.TWIN_MATRIX_SBT_ADDRESS ?? SBT_CONTRACT_ADDRESS_DEFAULT;
}

export function getAgentRegistryAddress(): string {
  const addr = process.env.AGENT_REGISTRY_CONTRACT_ADDRESS;
  if (!addr) throw new Error("AGENT_REGISTRY_CONTRACT_ADDRESS is not set");
  return addr;
}

export function getPermissionContractAddress(): string {
  // Permission 可能整合在 SBT 合約裡，或是獨立合約
  // 開會後確認
  const addr = process.env.PERMISSION_CONTRACT_ADDRESS?.trim() || getSbtContractAddress();
  return addr;
}

// =========================================================================
// ABIs（開會後由合約工程師提供，填入此處）
// =========================================================================

/**
 * SBT 合約 ABI（片段）
 *
 * 已確認（selector 驗證）：
 *   tokenIdOf(address)                          0x773c02d4
 *   getAuthorizedLatestValues(uint256)          0xcda0f320  ← 需以 agentAddress 為 from 呼叫
 *
 * 待確認：
 *   getPermission(agentAddress)
 *   bindAndGrant(agentAddress, scopeMask, expiry)
 *   updateGrant(agentAddress, scopeMask, expiry)
 */
export const SBT_ABI: string[] = [
  // 已確認
  "function tokenIdOf(address ownerAddress) view returns (uint256)",
  "function getAuthorizedLatestValues(uint256 tokenId) view returns (uint8[] indices, uint8[] values, uint32 version, bytes32 digest, uint64 blockNumber)",
  "function getBoundAgents(uint256 tokenId) view returns (address[] agents)",

  // TODO: 待合約工程師確認
  // "function getPermission(address agentAddress) view returns (address owner, uint256 scopeMask, uint256 expiry, uint256 permissionVersion)",
  // "function bindAndGrant(address agentAddress, uint256 scopeMask, uint256 expiry) external",
  // "function updateGrant(address agentAddress, uint256 scopeMask, uint256 expiry) external",
];

/**
 * ERC8004 AgentRegistry ABI（片段）
 *
 * 待確認函式：
 *   registerAgent(...)  → 龍蝦鏈上身份，由 bnbagent SDK 處理
 */
export const AGENT_REGISTRY_ABI: unknown[] = [
  // TODO: 開會後填入 / 由 bnbagent SDK 內建處理
];
