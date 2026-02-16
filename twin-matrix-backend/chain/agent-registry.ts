/**
 * ERC8004 Agent Registry
 *
 * CHAIN_ENABLED=false → mock 模式，回傳隨機 wallet，不送鏈上交易
 * CHAIN_ENABLED=true  → 呼叫 chain/register_agent.py（bnbagent SDK，Gasless）
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentWallet, isChainEnabled } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "register_agent.py");

export type RegisterAgentResult = {
  agentAddress: string;
  privateKey: string;
  onChainAgentId?: string;  // ERC8004 agentId（CHAIN_ENABLED=true 時有值）
};

/**
 * 呼叫 Python script，回傳解析後的 JSON
 */
function runPythonRegister(
  ownerAddress: string,
  privateKey: string,
  agentName: string,
): Promise<{ agentId: string; agentAddress: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [SCRIPT_PATH, ownerAddress, privateKey, agentName]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`register_agent.py failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim()) as { agentId: string; agentAddress: string };
        resolve(result);
      } catch {
        reject(new Error(`register_agent.py invalid output: ${stdout.trim()}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });
  });
}

/**
 * 建立龍蝦錢包 + ERC8004 鏈上註冊
 *
 * @param ownerAddress - 使用者錢包地址
 * @param tokenId      - 使用者的 SBT tokenId（目前未使用，保留供後續）
 * @param agentName    - 龍蝦名稱（選填）
 */
export async function registerAgentOnChain(
  ownerAddress: string,
  tokenId: string,
  agentName = "Twin Matrix Agent",
): Promise<RegisterAgentResult> {
  // 建立龍蝦錢包
  const wallet = createAgentWallet();

  if (!isChainEnabled()) {
    console.log(`[chain:mock] registerAgent(owner=${ownerAddress}, tokenId=${tokenId})`);
    console.log(`[chain:mock] agentAddress=${wallet.address}`);
    return {
      agentAddress: wallet.address,
      privateKey: wallet.privateKey,
    };
  }

  // 真實鏈上：呼叫 Python script（Gasless via MegaFuel Paymaster）
  console.log(`[chain] registerAgent(owner=${ownerAddress}) → python3 register_agent.py`);
  const result = await runPythonRegister(ownerAddress, wallet.privateKey, agentName);

  console.log(`[chain] ERC8004 registered: agentId=${result.agentId} agentAddress=${result.agentAddress}`);

  return {
    agentAddress: result.agentAddress,
    privateKey: wallet.privateKey,
    onChainAgentId: result.agentId,
  };
}
