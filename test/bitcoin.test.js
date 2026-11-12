import test from "node:test";
import assert from "node:assert/strict";
import {
  HALVING_INTERVAL,
  MAX_MONEY,
  blockReward,
  feeAt,
  halvingEpoch,
  halvingSchedule,
  retargetDifficulty,
  seededRandom,
  subsidyAt,
  totalSupplyAt,
} from "../src/bitcoin.js";
import { gini, hhi, topShare } from "../src/stats.js";

test("subsidy halves every 210,000 blocks", () => {
  assert.equal(subsidyAt(0), 50);
  assert.equal(subsidyAt(HALVING_INTERVAL - 1), 50);
  assert.equal(subsidyAt(HALVING_INTERVAL), 25);
  assert.equal(subsidyAt(2 * HALVING_INTERVAL), 12.5);
  assert.equal(subsidyAt(3 * HALVING_INTERVAL), 6.25);
});

test("halvingEpoch identifies the epoch", () => {
  assert.equal(halvingEpoch(0), 0);
  assert.equal(halvingEpoch(HALVING_INTERVAL - 1), 0);
  assert.equal(halvingEpoch(HALVING_INTERVAL), 1);
});

test("cumulative supply follows the Bitcoin cap", () => {
  assert.equal(totalSupplyAt(HALVING_INTERVAL), 10_500_000);
  assert.equal(totalSupplyAt(2 * HALVING_INTERVAL), 15_750_000);
  assert.ok(totalSupplyAt(6_930_000) < MAX_MONEY);
  assert.ok(totalSupplyAt(6_930_000) > 20_999_000);
  assert.ok(totalSupplyAt(10_000_000) < MAX_MONEY);
});

test("fees rise across halving epochs and then plateau", () => {
  assert.ok(feeAt(0) > 0);
  assert.ok(feeAt(HALVING_INTERVAL) > feeAt(0));
  assert.ok(feeAt(4 * HALVING_INTERVAL) > feeAt(2 * HALVING_INTERVAL));
  assert.equal(feeAt(10 * HALVING_INTERVAL), feeAt(20 * HALVING_INTERVAL));
  assert.equal(blockReward(0), subsidyAt(0) + feeAt(0));
});

test("difficulty retarget is clamped to four times", () => {
  assert.equal(retargetDifficulty(100, 2_016 * 600), 100);
  assert.equal(retargetDifficulty(100, 1), 400);
  assert.equal(retargetDifficulty(100, 10_000_000), 25);
});

test("halvingSchedule reports six epochs", () => {
  const schedule = halvingSchedule(6);
  assert.equal(schedule.length, 6);
  assert.equal(schedule[0].subsidy, 50);
  assert.equal(schedule[1].subsidy, 25);
  assert.ok(schedule[5].supplyAfterEpoch > schedule[0].supplyAfterEpoch);
});

test("seededRandom is deterministic", () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.equal(a(), b());
  assert.equal(a(), b());
  const c = seededRandom(8);
  assert.notEqual(seededRandom(7)(), c());
});

test("concentration statistics behave", () => {
  assert.equal(gini([1, 1, 1, 1]), 0);
  assert.ok(gini([100, 0, 0, 0]) > 0.7);
  assert.equal(hhi([0.5, 0.5]), 0.5);
  assert.equal(topShare([1, 1, 2]), 0.5);
});
