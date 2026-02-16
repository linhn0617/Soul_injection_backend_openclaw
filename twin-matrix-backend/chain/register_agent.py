#!/usr/bin/env python3
"""
ERC8004 Agent Registration Script
呼叫方式：
  python3 register_agent.py <ownerAddress> <privateKey> [agentName]

成功時輸出 JSON（stdout）：
  {"agentId": "...", "agentAddress": "0x..."}

失敗時 exit code 非 0，錯誤訊息輸出到 stderr
"""

import sys
import json
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: register_agent.py <ownerAddress> <privateKey> [agentName]", file=sys.stderr)
        sys.exit(1)

    owner_address = sys.argv[1]
    private_key   = sys.argv[2]
    agent_name    = sys.argv[3] if len(sys.argv) > 3 else "Twin Matrix Agent"

    # password 用 private_key 本身（只是為了 keystore 加密格式，不對外暴露）
    password = private_key

    try:
        from bnbagent import ERC8004Agent, EVMWalletProvider, AgentEndpoint
    except ImportError as e:
        print(f"bnbagent SDK not installed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        # 用龍蝦私鑰建立 wallet，password 僅用於 keystore 加密
        wallet = EVMWalletProvider(password=password, private_key=private_key)
        sdk = ERC8004Agent(wallet_provider=wallet, network="bsc-testnet")

        # 定義龍蝦身份
        agent_uri = sdk.generate_agent_uri(
            name=agent_name,
            description="Twin Matrix AI agent powered by OpenClaw.",
            endpoints=[
                AgentEndpoint(
                    name="twin-matrix",
                    endpoint="https://twin3.ai",
                    version="1.0.0"
                )
            ]
        )

        # 上鏈（Gasless via MegaFuel Paymaster）
        result = sdk.register_agent(agent_uri=agent_uri)

        output = {
            "agentId":      result["agentId"],
            "agentAddress": result.get("agentAddress", wallet.address),
        }
        print(json.dumps(output))
        sys.exit(0)

    except Exception as e:
        print(f"registerAgent failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
