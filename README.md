# Hoofs Lab — Proof of Hoof on Bitcoin

A deterministic test bed for applying the Proof-of-Hoof mechanics to **Bitcoin as a
whole**.

This folder is intentionally separate from the three PoH product repositories. The
subject here is another project — Bitcoin — and the question is narrow:

> What happens if the Proof-of-Hoof rating and recovery mechanics are layered over
> Bitcoin's proof of work and block schedule?

The lab does **not** connect to a Bitcoin node, mine, hold keys, move funds, or propose a
consensus change. It is a research harness with reproducible simulations and tests.

```text
Bitcoin model  ->  blocks, halvings, fees, miners
PoH ledger     ->  stake, capacity, rating, Stasis, recovery
Overlay        ->  attestations, finality, attack stress, reputation
```

---

## What is modelled

### Bitcoin

- 50 BTC initial subsidy.
- Halving every 210,000 blocks.
- 10-minute target block interval.
- 2,016-block difficulty retarget, clamped to 4×.
- A fee market that rises across halving epochs and then plateaus.
- A deterministic miner set whose shares sum to one.
- The 21,000,000 BTC cap.

This is a monetary and block-production model, not a full node. It is deliberately small
enough to test ideas quickly and exactly.

### Proof of Hoof

The lab uses a JavaScript mirror of the rating ledger:

- Hash share is stake.
- Staking grants rating capacity.
- Rating spends capacity and records permanent attribution.
- Subject Stasis grows each period.
- Capacity recovers lazily from `min(attribution, stake)`.
- Fully unstaked actors stop recovering.
- There is no burn, slashing, decay, or negative rating.

### The overlay

Miners attest to a block `lag` blocks after it is found. Attestations are spread over a
small `window`, so finality is not artificially instantaneous. The attestation amount is
proportional to hash share. A block becomes **hoof-final** when the attesting weight
reaches a threshold (2/3 by default).

The overlay is a *view*, not a replacement for proof of work. It provides a BFT-style
finality signal over the same blocks.

---

## Scenarios

### 1. Baseline

Reports miner revenue, fee dependence, Gini, HHI, and top share under pure proof of
work.

### 2. Attestation overlay

Reports coverage, finality delay, and accumulated Stasis. With every miner attesting,
a block finalizes exactly `lag` blocks after it is found.

### 3. Attack stress

Tests attacker shares of 20%, 34%, 40%, 60%, and 70%.

- Safety: an attacker below 2/3 cannot finalize its own fork.
- Liveness: honest miners below 2/3 cannot finalize the honest chain.
- An attacker above 1/3 can stall finality.

That is the classic 2/3 safety / 1/3 liveness boundary, reproduced by the simulation.

### 4. Late-chain reputation rebate

The reputation experiment runs on a separate chain window starting at height 6,300,000,
where fees dominate the subsidy. It spends 10% of fees on a rebate proportional to Hoof
attribution. In the default miner set, large miners attest less consistently than small
miners, so the rebate shifts revenue toward the small ones. The lab reports the Gini and
top-share change.

This scenario is explicitly speculative. It changes fee distribution, not Bitcoin
consensus.

---

## Run

No dependencies are required. Node.js 20+.

```bash
npm run sim
npm test
npm run sim -- --blocks 50000 --seed 11
npm run sim -- --json
```

The default run covers 50,000 blocks. Use `--blocks 210000` for a full halving epoch. A
fixed seed reproduces the entire run.

---

## Files

```text
src/bitcoin.js            Subsidy, fees, supply, retarget, seeded PRNG.
src/poh.js                Minimal lazy Stasis ledger.
src/stats.js              Gini, HHI, top share, formatting.
src/adapters/bitcoin.js   Miner set, chain simulation, attestation, attack, reputation.
src/simulate.js           Human-readable and JSON reports.
test/                     Unit and integration tests.
```

---

## Tests

The suite checks:

- the halving schedule and 21M supply curve
- fee growth and retarget clamping
- deterministic PRNG behaviour
- concentration statistics
- stake-bounded lazy recovery
- permanent attribution
- no recovery after full unstake
- deterministic chain generation
- six-block attestation finality
- participation-sensitive delays
- the 2/3 safety and 1/3 liveness boundary
- the direction of the reputation-rebate experiment

---

## What this lab does not prove

- It does not prove that Bitcoin should adopt a PoH overlay.
- It does not model network latency, propagation, selfish mining, or orphan races in
  full detail.
- It does not model mining hardware, energy markets, or pool payout schemes.
- It does not move or custody Bitcoin.
- It does not change the production PoH contracts in the other folders.

It is a place to ask precise questions and get precise, repeatable answers before
building anything heavier.

---

## Relationship to the other projects

| Folder | Role |
|---|---|
| `proofofhoof1` | Pure HOOF coin, staking, and rating ledger |
| `proofofhoof2` | Cow NFT platform on top of HOOF |
| `proofofhoof3` | Guna game frontend over rating and NFT data |
| `hoofs` | This lab: apply the mechanics to Bitcoin |

The lab reuses only the *ideas* of the rating ledger. It has no dependency on the
Solidity contracts, the NFT platform, or the game frontend.
