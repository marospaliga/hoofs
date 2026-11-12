import {
  blockReward,
  feeAt,
  pickWeighted,
  seededRandom,
  subsidyAt,
} from "../bitcoin.js";
import { StasisLedger } from "../poh.js";
import { gini, hhi, sum, topShare } from "../stats.js";

/**
 * A plausible miner set for the lab. Shares sum to one.
 * `participation` is the probability that a miner attests to an honest block
 * in the overlay scenario. Large miners are slightly less consistent than the
 * small ones, which lets the reputation experiment show a real effect.
 */
export const DEFAULT_MINERS = [
  { name: "North Pool", share: 0.28, participation: 0.9 },
  { name: "South Pool", share: 0.22, participation: 0.92 },
  { name: "East Pool", share: 0.18, participation: 0.94 },
  { name: "West Pool", share: 0.14, participation: 0.96 },
  { name: "Small Miner 1", share: 0.08, participation: 0.99 },
  { name: "Small Miner 2", share: 0.06, participation: 0.99 },
  { name: "Small Miner 3", share: 0.04, participation: 1 },
];

const ATTEST_UNIT = 2;
const INITIAL_STAKE = 1000;

function hashString(value) {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function unitHash(name, height, seed) {
  let x = hashString(name) ^ Math.imul(height, 2_654_435_761) ^ seed;
  x ^= x >>> 16;
  x = Math.imul(x, 2_246_822_519);
  x ^= x >>> 13;
  x = Math.imul(x, 3_266_489_917);
  x ^= x >>> 16;
  return (x >>> 0) / 2 ** 32;
}

function shouldAttest(miner, height, seed) {
  const participation = miner.participation ?? 1;
  return unitHash(miner.name, height, seed) < participation;
}

/**
 * Build a deterministic chain of block rewards.
 * The result stores one record per block, which makes the lab easy to inspect.
 */
export function simulateChain({
  blocks = 210_000,
  seed = 7,
  miners = DEFAULT_MINERS,
  feeOptions = {},
  startHeight = 0,
} = {}) {
  if (!Array.isArray(miners) || miners.length === 0) {
    throw new Error("miners must be a non-empty array");
  }
  if (!Number.isInteger(startHeight) || startHeight < 0) {
    throw new Error("startHeight must be a non-negative integer");
  }
  const totalShare = sum(miners.map((miner) => miner.share));
  if (Math.abs(totalShare - 1) > 1e-9) {
    throw new Error(`miner shares must sum to 1, got ${totalShare}`);
  }

  const random = seededRandom(seed);
  const stats = new Map(
    miners.map((miner) => [
      miner.name,
      {
        ...miner,
        blocksFound: 0,
        subsidy: 0,
        fees: 0,
        revenue: 0,
      },
    ])
  );

  const records = [];
  for (let index = 0; index < blocks; index += 1) {
    const height = startHeight + index;
    const miner = pickWeighted(miners, (item) => item.share, random);
    const subsidy = subsidyAt(height);
    const fees = feeAt(height, feeOptions);
    const reward = blockReward(height, feeOptions);
    const entry = stats.get(miner.name);
    entry.blocksFound += 1;
    entry.subsidy += subsidy;
    entry.fees += fees;
    entry.revenue += reward;
    records.push({
      height,
      miner: miner.name,
      share: miner.share,
      subsidy,
      fees,
      reward,
    });
  }

  const minerStats = [...stats.values()];
  const totalSubsidy = sum(minerStats.map((miner) => miner.subsidy));
  const totalFees = sum(minerStats.map((miner) => miner.fees));
  const totalRevenue = totalSubsidy + totalFees;

  return {
    blocks: records,
    miners,
    stats: minerStats,
    startHeight,
    totals: {
      blocks,
      totalSubsidy,
      totalFees,
      totalRevenue,
      feeShare: totalRevenue > 0 ? totalFees / totalRevenue : 0,
    },
  };
}

/**
 * Apply the Hoof attestation overlay.
 *
 * Each miner receives a stake equal to its hash share and attests to a block
 * `lag` blocks after it is found. The attestation amount is proportional to
 * hash share. A block is "hoof-final" when the attesting weight reaches the
 * threshold (2/3 by default). The ledger's Stasis is only a reputation signal;
 * it does not change Bitcoin's proof of work.
 */
export function simulateAttestation({
  chain,
  lag = 6,
  window = 1,
  threshold = 2 / 3,
  seed = 11,
  growthRate = 0.02,
  recoveryRate = 0.5,
  miners = chain.miners,
} = {}) {
  if (chain.blocks.length === 0) throw new Error("chain is empty");
  if (lag < 0) throw new Error("lag must be >= 0");
  if (window < 1) throw new Error("window must be >= 1");
  if (threshold <= 0 || threshold > 1) {
    throw new Error("threshold must be in (0, 1]");
  }

  const ledger = new StasisLedger({ growthRate, recoveryRate });
  for (const miner of miners) {
    ledger.grantStake(miner.name, miner.share * INITIAL_STAKE);
  }

  const totalWeight = sum(miners.map((miner) => miner.share * ATTEST_UNIT));
  const needed = totalWeight * threshold;
  const attestations = new Map();
  const finality = new Map();
  const delays = [];

  for (let height = 0; height < chain.blocks.length; height += 1) {
    ledger.settle(1);

    // Stagger attestations across a small window. With window = 1 every
    // attester speaks at exactly `lag`; with a wider window the block gathers
    // weight over several heights, which produces a realistic delay spread.
    for (const miner of miners) {
      for (let offset = lag; offset < lag + window; offset += 1) {
        const targetHeight = height - offset;
        if (targetHeight < 0) continue;
        if (!shouldAttest(miner, targetHeight, seed)) continue;
        const jitter = Math.floor(
          unitHash(`${miner.name}:delay`, targetHeight, seed) * window
        );
        if (jitter !== offset - lag) continue;

        const amount = miner.share * ATTEST_UNIT;
        if (ledger.capacityOf(miner.name) + 1e-12 < amount) continue;
        const target = chain.blocks[targetHeight];
        ledger.rate(miner.name, `block:${target.height}`, amount);
        const record = attestations.get(targetHeight) || {
          weight: 0,
          attesters: [],
        };
        record.weight += amount;
        record.attesters.push(miner.name);
        attestations.set(targetHeight, record);
      }
    }

    for (let offset = lag; offset < lag + window; offset += 1) {
      const targetHeight = height - offset;
      if (targetHeight < 0) continue;
      const record = attestations.get(targetHeight);
      if (!record) continue;
      if (!finality.has(targetHeight) && record.weight + 1e-12 >= needed) {
        finality.set(targetHeight, height);
        delays.push(height - targetHeight);
      }
    }
  }

  const eligible = Math.max(0, chain.blocks.length - lag);
  const finalized = finality.size;
  const attribution = new Map(
    miners.map((miner) => [miner.name, ledger.totalAttributionOf(miner.name)])
  );
  const totalAttribution = sum([...attribution.values()]);

  return {
    ledger,
    lag,
    window,
    threshold,
    needed,
    totalWeight,
    attestations,
    finality,
    delays,
    finalized,
    eligible,
    coverage: eligible > 0 ? finalized / eligible : 0,
    averageDelay: delays.length > 0 ? sum(delays) / delays.length : null,
    minDelay:
      delays.length > 0
        ? delays.reduce((best, value) => Math.min(best, value), Infinity)
        : null,
    maxDelay:
      delays.length > 0
        ? delays.reduce((best, value) => Math.max(best, value), -Infinity)
        : null,
    attribution,
    totalAttribution,
    miners,
  };
}

/**
 * Stress the overlay with an attacker share that refuses to attest honest
 * blocks. The safety threshold is 2/3; the liveness threshold is 1/3.
 */
export function analyzeAttack({
  chain,
  attackerShare,
  lag = 6,
  window = 1,
  threshold = 2 / 3,
  seed = 11,
} = {}) {
  if (attackerShare < 0 || attackerShare > 1) {
    throw new Error("attackerShare must be in [0, 1]");
  }

  // Give the attacker its share and set its participation to zero. Honest
  // miners keep their own participation. The attacker is represented by one
  // synthetic miner so the shares still sum to one.
  const honestMiners = DEFAULT_MINERS.map((miner) => ({ ...miner }));
  const honestShare = 1 - attackerShare;
  const scaled = honestMiners.map((miner) => ({
    ...miner,
    share: miner.share * honestShare,
  }));
  const attacker = {
    name: "Attacker",
    share: attackerShare,
    participation: 0,
  };
  const miners = [...scaled, attacker];

  const honestRun = simulateAttestation({
    chain,
    lag,
    window,
    threshold,
    seed,
    miners,
  });

  const attackerWeight = attackerShare * 2;
  const attackerCanFinalize = attackerWeight + 1e-12 >= 2 * threshold;
  const honestWeight = honestShare * 2;
  const honestCanFinalize = honestWeight + 1e-12 >= 2 * threshold;

  return {
    attackerShare,
    honestShare,
    threshold,
    honestCanFinalize,
    attackerCanFinalize,
    honestCoverage: honestRun.coverage,
    honestAverageDelay: honestRun.averageDelay,
    livenessMargin: honestShare - threshold,
    safetyMargin: threshold - attackerShare,
  };
}

/**
 * A speculative overlay: spend a share of fees on a reputation rebate
 * proportional to Hoof attribution. This changes miner revenue, not Bitcoin
 * consensus. The experiment asks whether consistent small attestors gain.
 */
export function analyzeReputation({ chain, attestation, rebateRate = 0.1 } = {}) {
  if (!chain || !attestation) throw new Error("chain and attestation are required");
  if (rebateRate < 0 || rebateRate > 1) {
    throw new Error("rebateRate must be in [0, 1]");
  }

  const totalFees = chain.totals.totalFees;
  const rebatePool = totalFees * rebateRate;
  const totalAttribution = attestation.totalAttribution;

  const rows = chain.stats.map((miner) => {
    const attribution = attestation.attribution.get(miner.name) || 0;
    const reputationShare =
      totalAttribution > 0 ? attribution / totalAttribution : 0;
    const rebate = rebatePool * reputationShare;
    return {
      name: miner.name,
      share: miner.share,
      revenue: miner.revenue,
      attribution,
      reputationShare,
      rebate,
      adjustedRevenue: miner.revenue + rebate,
    };
  });

  const baseline = rows.map((row) => row.revenue);
  const adjusted = rows.map((row) => row.adjustedRevenue);

  return {
    rebateRate,
    rebatePool,
    rows,
    baselineGini: gini(baseline),
    adjustedGini: gini(adjusted),
    baselineTopShare: topShare(baseline),
    adjustedTopShare: topShare(adjusted),
    baselineHhi: hhi(rows.map((row) => row.revenue / sum(baseline))),
    adjustedHhi: hhi(rows.map((row) => row.adjustedRevenue / sum(adjusted))),
  };
}
