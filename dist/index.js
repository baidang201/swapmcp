import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
// Create an MCP server
const server = new McpServer({
    name: "UniswapMCP",
    version: "1.0.0"
});
// 合约ABI - 简化版仅包含我们需要使用的函数
const EXCHANGE_ABI = [
    "function addLiquidity(uint256 amountOfToken) public payable returns (uint256)",
    "function tokenToEthSwap(uint256 tokensToSwap, uint256 minEthToReceive) public",
    "function getReserve() public view returns (uint256)"
];
// 合约地址 - 这里需要替换为你的实际部署地址
const EXCHANGE_ADDRESS = "0xYourExchangeContractAddress";
const TOKEN_ADDRESS = "0xYourTokenContractAddress";
// ERC20 ABI
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];
// 设置provider和signer
let provider;
let signer;
let exchangeContract;
let tokenContract;
// 初始化以太坊连接
async function initEthers() {
    try {
        provider = new ethers.JsonRpcProvider("http://localhost:8545"); // 本地开发环境，实际使用时替换为你的RPC URL
        signer = await provider.getSigner();
        exchangeContract = new ethers.Contract(EXCHANGE_ADDRESS, EXCHANGE_ABI, signer);
        tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);
    }
    catch (error) {
        console.error("初始化以太坊连接失败:", error);
    }
}
// 初始化ethers
initEthers();
// Add liquidity tool
server.tool("addLiquidity", {
    amountOfToken: z.string(), // ethers.js使用字符串处理大整数
    ethAmount: z.string()
}, async ({ amountOfToken, ethAmount }) => {
    try {
        // 检查token授权
        const userAddress = await signer.getAddress();
        const allowance = await tokenContract.allowance(userAddress, EXCHANGE_ADDRESS);
        if (allowance < ethers.parseUnits(amountOfToken, 18)) {
            // 如果授权不足，先进行授权
            const approveTx = await tokenContract.approve(EXCHANGE_ADDRESS, ethers.parseUnits(amountOfToken, 18));
            await approveTx.wait();
        }
        // 添加流动性
        const tx = await exchangeContract.addLiquidity(ethers.parseUnits(amountOfToken, 18), { value: ethers.parseUnits(ethAmount, 18) });
        const receipt = await tx.wait();
        return {
            content: [{
                    type: "text",
                    text: `成功添加流动性! 交易哈希: ${receipt.hash}\n添加了 ${ethAmount} ETH 和 ${amountOfToken} Token`
                }]
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "未知错误";
        return {
            content: [{
                    type: "text",
                    text: `添加流动性失败: ${errorMessage}`
                }]
        };
    }
});
// Token 换 ETH 工具
server.tool("tokenToEthSwap", {
    tokensToSwap: z.string(),
    minEthToReceive: z.string()
}, async ({ tokensToSwap, minEthToReceive }) => {
    try {
        // 检查token授权
        const userAddress = await signer.getAddress();
        const allowance = await tokenContract.allowance(userAddress, EXCHANGE_ADDRESS);
        if (allowance < ethers.parseUnits(tokensToSwap, 18)) {
            // 如果授权不足，先进行授权
            const approveTx = await tokenContract.approve(EXCHANGE_ADDRESS, ethers.parseUnits(tokensToSwap, 18));
            await approveTx.wait();
        }
        // Token 换 ETH
        const tx = await exchangeContract.tokenToEthSwap(ethers.parseUnits(tokensToSwap, 18), ethers.parseUnits(minEthToReceive, 18));
        const receipt = await tx.wait();
        return {
            content: [{
                    type: "text",
                    text: `Token 换 ETH 成功! 交易哈希: ${receipt.hash}\n使用 ${tokensToSwap} Token 交换了 ETH`
                }]
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "未知错误";
        return {
            content: [{
                    type: "text",
                    text: `Token 换 ETH 失败: ${errorMessage}`
                }]
        };
    }
});
// Query current liquidity resource
server.resource("liquidity", new ResourceTemplate("liquidity://pool", { list: undefined }), async (uri) => {
    try {
        const reserve = await exchangeContract.getReserve();
        const ethBalance = await provider.getBalance(EXCHANGE_ADDRESS);
        return {
            contents: [{
                    uri: uri.href,
                    text: `当前池子状态:\nToken 余额: ${ethers.formatUnits(reserve, 18)}\nETH 余额: ${ethers.formatUnits(ethBalance, 18)}`
                }]
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "未知错误";
        return {
            contents: [{
                    uri: uri.href,
                    text: `获取流动性信息失败: ${errorMessage}`
                }]
        };
    }
});
// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
