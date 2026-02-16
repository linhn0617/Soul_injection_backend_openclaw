/**
 * ERC8004 Agent Registry
 *
 * 龍蝦鏈上註冊，由 bnbagent SDK 處理。
 *
 * 目前為骨架，等開會確認：
 *   - bnbagent SDK 套件名稱與安裝方式
 *   - registerAgent 的參數格式
 *   - 龍蝦 Gas 費來源（由誰預充值）
 *
 * CHAIN_ENABLED=false 時回傳 mock agentAddress，供 PoC 繼續運作。
 */

import { createAgentWallet, isChainEnabled } from "./client.js";

export type RegisterAgentResult = {
  agentAddress: string;
  privateKey: string;     // 需加密存儲
  txHash?: string;        // 鏈上 tx hash（CHAIN_ENABLED=true 時有值）
};

/**
 * 建立龍蝦錢包 + 跑 ERC8004 鏈上註冊
 *
 * @param ownerAddress - 使用者錢包地址
 * @param tokenId      - 使用者的 SBT tokenId
 *
 * TODO: 開會後改用 bnbagent SDK 實作
 *   import { BNBAgent } from "bnbagent"; // 套件名稱待確認
 *   const agent = await BNBAgent.register({ ownerAddress, ... });
 */
export async function registerAgentOnChain(
  ownerAddress: string,
  tokenId: string,
): Promise<RegisterAgentResult> {
  // 建立龍蝦錢包（確定要做，SDK 確認前先用 ethers）
  const wallet = createAgentWallet();

  if (!isChainEnabled()) {
    console.log(`[chain:mock] registerAgent(owner=${ownerAddress}, tokenId=${tokenId})`);
    console.log(`[chain:mock] agentAddress=${wallet.address}`);
    return {
      agentAddress: wallet.address,
      privateKey: wallet.privateKey,
      txHash: undefined,
    };
  }

  // TODO: 開會後用 bnbagent SDK 實作
  // const sdk = new BNBAgent({ privateKey: wallet.privateKey, rpcUrl: getRpcUrl() });
  // const tx = await sdk.registerAgent({ ownerAddress, tokenId, ... });
  // await tx.wait();
  // return { agentAddress: wallet.address, privateKey: wallet.privateKey, txHash: tx.hash };

  throw new Error("registerAgentOnChain: bnbagent SDK not yet configured. Pending meeting.");
}
