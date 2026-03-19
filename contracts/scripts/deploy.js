const { ethers, run } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying IntentSwap with: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  const FEE_RECIPIENT = process.env.FEE_RECIPIENT || deployer.address;
  const PROTOCOL_FEE_BPS = 30; // 0.3%

  // ── Deploy IntentSwap ──────────────────────────────────────────
  const IntentSwap = await ethers.getContractFactory("IntentSwap");
  const intentSwap = await IntentSwap.deploy(FEE_RECIPIENT, PROTOCOL_FEE_BPS);
  await intentSwap.waitForDeployment();
  const intentSwapAddr = await intentSwap.getAddress();
  console.log(`✅ IntentSwap deployed: ${intentSwapAddr}`);

  // ── Deploy Router ──────────────────────────────────────────────
  const Router = await ethers.getContractFactory("IntentSwapRouter");
  const router = await Router.deploy(intentSwapAddr);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(`✅ IntentSwapRouter deployed: ${routerAddr}`);

  // ── Log deployment info ────────────────────────────────────────
  const network = await ethers.provider.getNetwork();
  console.log(`\n📋 Deployment Summary`);
  console.log(`   Network:            ${network.name} (chainId: ${network.chainId})`);
  console.log(`   IntentSwap:         ${intentSwapAddr}`);
  console.log(`   IntentSwapRouter:   ${routerAddr}`);
  console.log(`   FeeRecipient:       ${FEE_RECIPIENT}`);
  console.log(`   ProtocolFee:        ${PROTOCOL_FEE_BPS} bps (${PROTOCOL_FEE_BPS / 100}%)`);

  // ── Verify (if not local) ──────────────────────────────────────
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\n⏳ Waiting for block confirmations...");
    await intentSwap.deploymentTransaction().wait(5);

    try {
      await run("verify:verify", {
        address: intentSwapAddr,
        constructorArguments: [FEE_RECIPIENT, PROTOCOL_FEE_BPS],
      });
      console.log("✅ IntentSwap verified on Etherscan");
    } catch (e) {
      console.log("❌ Verification failed:", e.message);
    }

    try {
      await run("verify:verify", {
        address: routerAddr,
        constructorArguments: [intentSwapAddr],
      });
      console.log("✅ Router verified on Etherscan");
    } catch (e) {
      console.log("❌ Router verification failed:", e.message);
    }
  }

  // ── Save deployment artifacts ──────────────────────────────────
  const { writeFileSync } = require("fs");
  const artifact = {
    network: network.name,
    chainId: network.chainId.toString(),
    IntentSwap: intentSwapAddr,
    IntentSwapRouter: routerAddr,
    feeRecipient: FEE_RECIPIENT,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(`deployments.${network.name}.json`, JSON.stringify(artifact, null, 2));
  console.log(`\n📁 Saved deployment to deployments.${network.name}.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
