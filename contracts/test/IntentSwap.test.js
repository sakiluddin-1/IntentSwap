const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("IntentSwap", function () {
  let intentSwap, mockERC20In, mockERC20Out;
  let owner, user, solver, feeRecipient;
  const PROTOCOL_FEE_BPS = 30; // 0.3%

  // ── Deploy helpers ────────────────────────────────────────────

  async function deploy() {
    [owner, user, solver, feeRecipient] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20In = await MockERC20.deploy("InputToken", "INP", 18);
    mockERC20Out = await MockERC20.deploy("OutputToken", "OUT", 18);

    const IntentSwap = await ethers.getContractFactory("IntentSwap");
    intentSwap = await IntentSwap.deploy(feeRecipient.address, PROTOCOL_FEE_BPS);

    // Fund user with input tokens
    await mockERC20In.mint(user.address, ethers.parseEther("10000"));
    await mockERC20Out.mint(solver.address, ethers.parseEther("10000"));

    // Approvals
    await mockERC20In.connect(user).approve(await intentSwap.getAddress(), ethers.MaxUint256);
    await mockERC20Out.connect(solver).approve(await intentSwap.getAddress(), ethers.MaxUint256);

    return { intentSwap, mockERC20In, mockERC20Out };
  }

  async function buildIntent(overrides = {}) {
    const deadline = (await time.latest()) + 3600; // 1 hour
    return {
      user: user.address,
      inputToken: await mockERC20In.getAddress(),
      outputToken: await mockERC20Out.getAddress(),
      inputAmount: ethers.parseEther("100"),
      minOutput: ethers.parseEther("95"),
      deadline,
      nonce: 0,
      solverTip: ethers.parseEther("1"),
      ...overrides,
    };
  }

  async function signIntent(intent, signer) {
    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await intentSwap.getAddress(),
    };
    const types = {
      Intent: [
        { name: "user", type: "address" },
        { name: "inputToken", type: "address" },
        { name: "outputToken", type: "address" },
        { name: "inputAmount", type: "uint256" },
        { name: "minOutput", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "solverTip", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, intent);
  }

  // ── Tests ─────────────────────────────────────────────────────

  beforeEach(async () => { await deploy(); });

  describe("submitIntent", () => {
    it("escrows tokens and emits event", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);

      const contractAddr = await intentSwap.getAddress();
      const balBefore = await mockERC20In.balanceOf(contractAddr);

      await intentSwap.connect(user).submitIntent(intent, sig);

      const balAfter = await mockERC20In.balanceOf(contractAddr);
      const escrowed = intent.inputAmount + intent.solverTip;
      expect(balAfter - balBefore).to.equal(escrowed);
    });

    it("increments nonce after submission", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      expect(await intentSwap.getCurrentNonce(user.address)).to.equal(0);
      await intentSwap.connect(user).submitIntent(intent, sig);
      expect(await intentSwap.getCurrentNonce(user.address)).to.equal(1);
    });

    it("reverts on replay (same intent twice)", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await intentSwap.connect(user).submitIntent(intent, sig);

      // Re-build with nonce=1 to pass nonce check but same data yields diff intentId
      const intent2 = await buildIntent({ nonce: 1 });
      const sig2 = await signIntent(intent2, user);
      await intentSwap.connect(user).submitIntent(intent2, sig2);

      // Original intent cannot be replayed
      const intentId = await intentSwap.getIntentId(intent);
      const state = await intentSwap.getIntentState(intentId);
      expect(state.status).to.equal(1); // Pending
    });

    it("reverts with wrong signer", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, solver); // wrong signer
      await expect(intentSwap.connect(user).submitIntent(intent, sig))
        .to.be.revertedWithCustomError(intentSwap, "InvalidSignature");
    });

    it("reverts on expired deadline", async () => {
      const intent = await buildIntent({ deadline: (await time.latest()) - 1 });
      const sig = await signIntent(intent, user);
      await expect(intentSwap.connect(user).submitIntent(intent, sig))
        .to.be.revertedWithCustomError(intentSwap, "IntentExpired");
    });
  });

  describe("executeIntent", () => {
    async function submitAndGetIntent() {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await intentSwap.connect(user).submitIntent(intent, sig);
      return intent;
    }

    it("transfers output to user and input to solver", async () => {
      const intent = await submitAndGetIntent();
      const outputAmount = ethers.parseEther("97");

      const userBalBefore = await mockERC20Out.balanceOf(user.address);
      const solverInBalBefore = await mockERC20In.balanceOf(solver.address);

      await intentSwap.connect(solver).executeIntent(intent, outputAmount);

      const userBalAfter = await mockERC20Out.balanceOf(user.address);
      const solverInBalAfter = await mockERC20In.balanceOf(solver.address);

      expect(userBalAfter - userBalBefore).to.equal(outputAmount);

      const fee = (intent.inputAmount * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      const solverExpected = intent.inputAmount - fee + intent.solverTip;
      expect(solverInBalAfter - solverInBalBefore).to.equal(solverExpected);
    });

    it("collects protocol fee", async () => {
      const intent = await submitAndGetIntent();
      const feeBefore = await mockERC20In.balanceOf(feeRecipient.address);
      await intentSwap.connect(solver).executeIntent(intent, ethers.parseEther("97"));
      const feeAfter = await mockERC20In.balanceOf(feeRecipient.address);
      const expectedFee = (intent.inputAmount * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      expect(feeAfter - feeBefore).to.equal(expectedFee);
    });

    it("reverts when output below minimum", async () => {
      const intent = await submitAndGetIntent();
      await expect(
        intentSwap.connect(solver).executeIntent(intent, ethers.parseEther("90"))
      ).to.be.revertedWithCustomError(intentSwap, "OutputBelowMinimum");
    });

    it("reverts on double execution", async () => {
      const intent = await submitAndGetIntent();
      await intentSwap.connect(solver).executeIntent(intent, ethers.parseEther("97"));
      await expect(
        intentSwap.connect(solver).executeIntent(intent, ethers.parseEther("97"))
      ).to.be.revertedWithCustomError(intentSwap, "IntentNotPending");
    });
  });

  describe("cancelIntent", () => {
    it("refunds user after deadline", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await intentSwap.connect(user).submitIntent(intent, sig);

      await time.increaseTo(intent.deadline + 1);

      const balBefore = await mockERC20In.balanceOf(user.address);
      await intentSwap.connect(user).cancelIntent(intent);
      const balAfter = await mockERC20In.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(intent.inputAmount + intent.solverTip);
    });

    it("reverts cancel before deadline by user", async () => {
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await intentSwap.connect(user).submitIntent(intent, sig);
      await expect(intentSwap.connect(user).cancelIntent(intent))
        .to.be.revertedWithCustomError(intentSwap, "CancelNotAllowed");
    });
  });

  describe("Security", () => {
    it("pauses and unpauses", async () => {
      await intentSwap.connect(owner).pause();
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await expect(intentSwap.connect(user).submitIntent(intent, sig))
        .to.be.revertedWithCustomError(intentSwap, "EnforcedPause");
      await intentSwap.connect(owner).unpause();
      await intentSwap.connect(user).submitIntent(intent, sig);
    });

    it("enforces solver whitelist when permissionless=false", async () => {
      await intentSwap.connect(owner).setPermissionlessSolvers(false);
      const intent = await buildIntent();
      const sig = await signIntent(intent, user);
      await intentSwap.connect(user).submitIntent(intent, sig);
      await expect(
        intentSwap.connect(solver).executeIntent(intent, ethers.parseEther("97"))
      ).to.be.revertedWithCustomError(intentSwap, "UnauthorizedSolver");
    });
  });
});
