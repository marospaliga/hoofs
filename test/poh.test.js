import test from "node:test";
import assert from "node:assert/strict";
import { StasisLedger } from "../src/poh.js";

test("stake grants capacity one-for-one", () => {
  const ledger = new StasisLedger();
  ledger.grantStake("alice", 100);
  assert.equal(ledger.stakeOf("alice"), 100);
  assert.equal(ledger.capacityOf("alice"), 100);
});

test("rating spends capacity and records permanent attribution", () => {
  const ledger = new StasisLedger();
  ledger.grantStake("alice", 100);
  ledger.rate("alice", "block:1", 40);
  assert.equal(ledger.capacityOf("alice"), 60);
  assert.equal(ledger.attributionOf("block:1", "alice"), 40);
  assert.equal(ledger.totalAttributionOf("alice"), 40);
  assert.equal(ledger.stasisOf("block:1"), 40);

  ledger.settle(1);
  assert.ok(ledger.stasisOf("block:1") > 40);
  assert.equal(ledger.attributionOf("block:1", "alice"), 40);
});

test("recovery is lazy and bounded by attribution and stake", () => {
  const ledger = new StasisLedger({ growthRate: 0.1, recoveryRate: 0.5 });
  ledger.grantStake("alice", 100);
  ledger.rate("alice", "block:1", 100);
  assert.equal(ledger.capacityOf("alice"), 0);

  ledger.settle(1);
  assert.equal(ledger.capacityOf("alice"), 50);

  ledger.settle(1);
  assert.equal(ledger.capacityOf("alice"), 100);

  // Attribution is 100 and stake is 100, so each period recovers 50.
  ledger.settle(1);
  assert.equal(ledger.capacityOf("alice"), 150);
});

test("a fully revoked stake stops recovery", () => {
  const ledger = new StasisLedger({ growthRate: 0.1, recoveryRate: 0.5 });
  ledger.grantStake("alice", 100);
  ledger.rate("alice", "block:1", 100);

  ledger.settle(2);
  assert.equal(ledger.capacityOf("alice"), 100);
  ledger.revokeStake("alice", 100);
  assert.equal(ledger.stakeOf("alice"), 0);
  assert.equal(ledger.capacityOf("alice"), 0);

  ledger.settle(10);
  assert.equal(ledger.capacityOf("alice"), 0);
  assert.equal(ledger.attributionOf("block:1", "alice"), 100);
});

test("revoking more than the unspent capacity is rejected", () => {
  const ledger = new StasisLedger();
  ledger.grantStake("alice", 100);
  ledger.rate("alice", "block:1", 90);
  assert.throws(() => ledger.revokeStake("alice", 20), /insufficient capacity/);
});

test("rating zero or negative amounts is rejected", () => {
  const ledger = new StasisLedger();
  ledger.grantStake("alice", 10);
  assert.throws(() => ledger.rate("alice", "block:1", 0), /must be > 0/);
  assert.throws(() => ledger.rate("alice", "block:1", -1), /must be > 0/);
});

test("settling many periods at once equals settling one at a time", () => {
  const one = new StasisLedger({ growthRate: 0.1, recoveryRate: 0.25 });
  const many = new StasisLedger({ growthRate: 0.1, recoveryRate: 0.25 });
  for (const ledger of [one, many]) {
    ledger.grantStake("alice", 100);
    ledger.rate("alice", "block:1", 80);
  }
  for (let i = 0; i < 6; i += 1) one.settle(1);
  many.settle(6);

  assert.ok(Math.abs(one.stasisOf("block:1") - many.stasisOf("block:1")) < 1e-9);
  assert.ok(
    Math.abs(one.capacityOf("alice") - many.capacityOf("alice")) < 1e-9
  );
});
