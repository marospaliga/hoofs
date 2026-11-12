import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MINERS,
  analyzeAttack,
  analyzeReputation,
  simulateAttestation,
  simulateChain,
} from "../src/adapters/bitcoin.js";

const BLOCKS = 5_000;
const SEED = 7;

test("simulateChain is deterministic and preserves total rewards", () => {
  const a = simulateChain({ blocks: BLOCKS, seed: SEED });
  const b = simulateChain({ blocks: BLOCKS, seed: SEED });
  assert.equal(a.blocks.length, BLOCKS);
  assert.equal(a.blocks[0].height, 0);
  assert.equal(a.blocks[0].miner, b.blocks[0].miner);
  assert.equal(a.blocks[4999].miner, b.blocks[4999].miner);

  const total = a.stats.reduce((sum, miner) => sum + miner.revenue, 0);
  assert.ok(Math.abs(total - a.totals.totalRevenue) < 1e-6);
  assert.equal(
    a.stats.reduce((sum, miner) => sum + miner.blocksFound, 0),
    BLOCKS
  );
  assert.equal(
    a.stats.reduce((sum, miner) => sum + miner.share, 0).toFixed(6),
    "1.000000"
  );
});

test("miner shares must sum to one", () => {
  assert.throws(
    () =>
      simulateChain({
        blocks: 10,
        miners: [{ name: "A", share: 0.5 }],
      }),
    /must sum to 1/
  );
});

test("the attestation overlay finalizes blocks with a six-block lag", () => {
  const chain = simulateChain({ blocks: BLOCKS, seed: SEED });
  const miners = DEFAULT_MINERS.map((miner) => ({ ...miner, participation: 1 }));
  const attestation = simulateAttestation({
    chain,
    lag: 6,
    window: 1,
    seed: 11,
    miners,
  });

  assert.equal(attestation.coverage, 1);
  assert.equal(attestation.minDelay, 6);
  assert.equal(attestation.maxDelay, 6);
  assert.equal(attestation.averageDelay, 6);
  assert.equal(attestation.finalized, BLOCKS - 6);
  assert.ok(attestation.totalAttribution > 0);
});

test("a wider attestation window produces a delay spread", () => {
  const chain = simulateChain({ blocks: BLOCKS, seed: SEED });
  const attestation = simulateAttestation({ chain, lag: 6, window: 6, seed: 11 });
  assert.ok(attestation.minDelay >= 6);
  assert.ok(attestation.maxDelay > 6);
  assert.ok(attestation.averageDelay > 6);
});

test("a lower participation rate can delay finality", () => {
  const chain = simulateChain({ blocks: 2_000, seed: SEED });
  const miners = DEFAULT_MINERS.map((miner) => ({
    ...miner,
    participation: miner.share > 0.2 ? 0.5 : 1,
  }));
  const attestation = simulateAttestation({
    chain,
    lag: 4,
    window: 4,
    seed: 11,
    miners,
  });
  assert.ok(attestation.coverage < 1);
  assert.ok(attestation.maxDelay > 4);
});

test("the overlay has a 2/3 safety and 1/3 liveness boundary", () => {
  const chain = simulateChain({ blocks: 2_000, seed: SEED });

  const small = analyzeAttack({ chain, attackerShare: 0.2 });
  assert.equal(small.honestCanFinalize, true);
  assert.equal(small.attackerCanFinalize, false);

  const third = analyzeAttack({ chain, attackerShare: 0.34 });
  assert.equal(third.honestCanFinalize, false);
  assert.equal(third.attackerCanFinalize, false);

  const majority = analyzeAttack({ chain, attackerShare: 0.7 });
  assert.equal(majority.honestCanFinalize, false);
  assert.equal(majority.attackerCanFinalize, true);
});

test("honest coverage falls when the attacker withholds attestations", () => {
  const chain = simulateChain({ blocks: 2_000, seed: SEED });
  const attestation = analyzeAttack({ chain, attackerShare: 0.4 });
  assert.equal(attestation.honestCanFinalize, false);
  assert.equal(attestation.honestCoverage, 0);
});

test("a reputation rebate shifts fees toward consistent small attestors", () => {
  const chain = simulateChain({ blocks: BLOCKS, seed: SEED });
  const attestation = simulateAttestation({ chain, lag: 6, seed: 11 });
  const reputation = analyzeReputation({ chain, attestation, rebateRate: 0.1 });

  assert.ok(reputation.adjustedGini < reputation.baselineGini);
  assert.ok(reputation.adjustedTopShare < reputation.baselineTopShare);
  assert.ok(reputation.rebatePool > 0);
  assert.equal(reputation.rows.length, chain.stats.length);
});
