/**
 * Chain Client
 *
 * ethers.js provider + wallet 基礎設施
 *
 * 環境變數：
 *   CHAIN_ENABLED=true          → 實際送鏈上交易
 *   CHAIN_ENABLED=false（預設）  → 僅 log，不送交易（PoC mock 模式）
 *   RPC_URL                     → BNB Testnet RPC endpoint（開會後填入）
 *   OPERATOR_PRIVATE_KEY        → operator wallet 私鑰（備用，目前龍蝦自帶錢包）
 */

import { JsonRpcProvider, Wallet } from "ethers";

// =========================================================================
// Config
// =========================================================================

export function isChainEnabled(): boolean {
  return process.env.CHAIN_ENABLED === "true";
}

function getRpcUrl(): string {
  const url = process.env.RPC_URL;
  if (!url) {
    throw new Error("RPC_URL is not set. Please configure it in .env");
  }
  return url;
}

// =========================================================================
// Provider（read-only，用於 eth_call）
// =========================================================================

let _provider: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (!_provider) {
    _provider = new JsonRpcProvider(getRpcUrl());
  }
  return _provider;
}

// =========================================================================
// Agent Wallet（龍蝦自帶錢包，用於 registerAgent 等鏈上交易）
// =========================================================================

/**
 * 從私鑰建立龍蝦 wallet（連接 provider，可送交易）
 * 私鑰儲存在 data/agents/{agentId}.json 的 encryptedKey 欄位
 *
 * TODO: 正式版應加密存儲私鑰，目前 PoC 直接存明文
 */
export function getAgentWallet(privateKey: string): Wallet {
  return new Wallet(privateKey, getProvider());
}

/**
 * 產生新的龍蝦錢包
 * 目前由此函式產生，待 bnbagent SDK 確認後可能改用 SDK 內建方法
 *
 * @returns { address, privateKey }
 */
export function createAgentWallet(): { address: string; privateKey: string } {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}
