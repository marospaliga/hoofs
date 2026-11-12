/**
 * Hoofs Lab — apply Proof-of-Hoof mechanics to Bitcoin.
 *
 * Run:
 *   npm run sim
 *   npm run sim -- --blocks 50000 --seed 11
 *   npm run sim -- --json
 *
 * The lab is a deterministic research harness. It does not connect to a
 * Bitcoin node, does not propose a consensus change, and does not move funds.
 */

import {
  HALVING_INTERVAL,
  MAX_MONEY,
  halvingSchedule,
  totalSupplyAt,
} from "./bitcoin.js";
import {
  DEFAULT_MINERS,
  analyzeAttack,
  analyzeReputation,
  simulateAttestation,
  simulateChain,
} from "./adapters/bitcoin.js";
import { formatBtc, formatPct, gini, hhi, topShare } from "./stats.js";

function parseArgs(argv) {
  const args = { blocks: 50_000, seed: 7, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--blocks") {
      args.blocks = Number(argv[++i]);
    } else if (arg === "--seed") {
      args.seed = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run sim -- [--blocks N] [--seed N] [--json]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.blocks) || args.blocks <= 0) {
    throw new Error("--blocks must be a positive integer");
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error("--seed must be an integer");
  }
  return args;
}

function printHeader(args, chain, attackChain, lateChain) {
  console.log("Hoofs Lab — Proof of Hoof applied to Bitcoin");
  console.log(
    `Chain: ${args.blocks.toLocaleString()} blocks from height ${chain.startHeight.toLocaleString()} | Seed: ${args.seed} | ${DEFAULT_MINERS.length} miners`
  );
  console.log(
    `Attack model: ${attackChain.blocks.length.toLocaleString()} blocks | Reputation model: ${lateChain.blocks.length.toLocaleString()} blocks from height ${lateChain.startHeight.toLocaleString()}`
  );
  console.log("");
}

function printMonetarySchedule() {
  console.log("Bitcoin monetary schedule");
  console.log("| Epoch | Height | Subsidy BTC | Supply after epoch |");
  console.log("|---|---:|---:|---:|");
  for (const row of halvingSchedule(6)) {
    console.log(
      `| ${row.epoch} | ${row.height.toLocaleString()} | ${formatBtc(row.subsidy)} | ${formatBtc(row.supplyAfterEpoch)} |`
    );
  }
  const nearCap = totalSupplyAt(6_930_000);
  console.log(
    `Supply near the last halving: ${formatBtc(nearCap)} / ${formatBtc(MAX_MONEY)} BTC`
  );
  console.log("");
}

function printBaseline(chain) {
  const revenue = chain.stats.map((miner) => miner.revenue);
  const shares = chain.stats.map((miner) => miner.revenue / chain.totals.totalRevenue);
  console.log("Baseline proof-of-work revenue");
  console.log("| Miner | Hash share | Blocks | Revenue BTC | Revenue share |");
  console.log("|---|---:|---:|---:|---:|");
  for (const miner of chain.stats) {
    console.log(
      `| ${miner.name} | ${formatPct(miner.share)} | ${miner.blocksFound.toLocaleString()} | ${formatBtc(miner.revenue)} | ${formatPct(miner.revenue / chain.totals.totalRevenue)} |`
    );
  }
  console.log(
    `Total: ${formatBtc(chain.totals.totalRevenue)} BTC (${formatPct(chain.totals.feeShare)} fees) | Gini ${gini(revenue).toFixed(3)} | HHI ${hhi(shares).toFixed(3)} | top ${formatPct(topShare(revenue))}`
  );
  console.log("");
}

function printAttestation(chain, attestation) {
  const latest = chain.blocks[
    Math.max(0, chain.blocks.length - 1 - attestation.lag - attestation.window)
  ];
  console.log("Hoof attestation overlay");
  console.log(
    `Finalized ${attestation.finalized.toLocaleString()} / ${attestation.eligible.toLocaleString()} eligible blocks (${formatPct(attestation.coverage)})`
  );
  console.log(
    `Finality delay: avg ${attestation.averageDelay?.toFixed(2) ?? "n/a"} blocks | min ${attestation.minDelay ?? "n/a"} | max ${attestation.maxDelay ?? "n/a"} (lag ${attestation.lag}, window ${attestation.window})`
  );
  if (latest) {
    console.log(
      `Stasis on block ${latest.height.toLocaleString()}: ${attestation.ledger.stasisOf(`block:${latest.height}`).toFixed(2)}`
    );
  }
  console.log(
    `Attribution recycled: ${attestation.totalAttribution.toFixed(0)} units across ${attestation.miners.length} miners`
  );
  console.log(
    "The overlay does not replace proof of work. It adds a 2/3 attestation view of finality."
  );
  console.log("");
}

function printAttacks(attacks) {
  console.log("Attack stress");
  console.log(
    "| Attacker share | Honest finalizes | Attacker finalizes | Liveness margin | Safety margin |"
  );
  console.log("|---:|---|---|---:|---:|");
  for (const result of attacks) {
    console.log(
      `| ${formatPct(result.attackerShare)} | ${result.honestCanFinalize ? "yes" : "no"} | ${result.attackerCanFinalize ? "yes" : "no"} | ${formatPct(Math.max(0, result.livenessMargin))} | ${formatPct(Math.max(0, result.safetyMargin))} |`
    );
  }
  console.log(
    "Safety needs less than 2/3. Liveness needs at least 2/3 honest. An attacker above 1/3 can stall finality."
  );
  console.log("");
}

function printReputation(reputation, chain) {
  console.log(
    `Reputation rebate experiment (10% of fees, height ${chain.startHeight.toLocaleString()}+)`
  );
  console.log(
    `Fee share of revenue in this late-chain window: ${formatPct(chain.totals.feeShare)}`
  );
  console.log("| Miner | Revenue BTC | Attribution | Rebate BTC | Adjusted BTC |");
  console.log("|---|---:|---:|---:|---:|");
  for (const row of reputation.rows) {
    console.log(
      `| ${row.name} | ${formatBtc(row.revenue)} | ${row.attribution.toFixed(1)} | ${formatBtc(row.rebate, 4)} | ${formatBtc(row.adjustedRevenue)} |`
    );
  }
  console.log(
    `Gini ${reputation.baselineGini.toFixed(3)} -> ${reputation.adjustedGini.toFixed(3)} | top share ${formatPct(reputation.baselineTopShare)} -> ${formatPct(reputation.adjustedTopShare)}`
  );
  console.log(
    "This is a speculative overlay on fee distribution, not a Bitcoin consensus rule."
  );
  console.log("");
}

function summarize({ chain, attestation, attacks, reputation, lateChain }) {
  return {
    blocks: chain.totals.blocks,
    startHeight: chain.startHeight,
    totalSubsidy: chain.totals.totalSubsidy,
    totalFees: chain.totals.totalFees,
    feeShare: chain.totals.feeShare,
    baselineGini: gini(chain.stats.map((miner) => miner.revenue)),
    miners: chain.stats.map((miner) => ({
      name: miner.name,
      share: miner.share,
      blocks: miner.blocksFound,
      revenue: miner.revenue,
    })),
    attestation: {
      lag: attestation.lag,
      window: attestation.window,
      finalized: attestation.finalized,
      eligible: attestation.eligible,
      coverage: attestation.coverage,
      averageDelay: attestation.averageDelay,
      minDelay: attestation.minDelay,
      maxDelay: attestation.maxDelay,
      totalAttribution: attestation.totalAttribution,
    },
    attacks: attacks.map((attack) => ({
      attackerShare: attack.attackerShare,
      honestCanFinalize: attack.honestCanFinalize,
      attackerCanFinalize: attack.attackerCanFinalize,
      livenessMargin: attack.livenessMargin,
      safetyMargin: attack.safetyMargin,
    })),
    reputation: {
      startHeight: lateChain.startHeight,
      feeShare: lateChain.totals.feeShare,
      rebateRate: reputation.rebateRate,
      baselineGini: reputation.baselineGini,
      adjustedGini: reputation.adjustedGini,
      baselineTopShare: reputation.baselineTopShare,
      adjustedTopShare: reputation.adjustedTopShare,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const chain = simulateChain({
    blocks: args.blocks,
    seed: args.seed,
    startHeight: 0,
  });
  const attestation = simulateAttestation({ chain, lag: 6, window: 6 });

  const attackChain = simulateChain({
    blocks: Math.min(args.blocks, 20_000),
    seed: args.seed + 1,
    startHeight: 0,
  });
  const attacks = [0.2, 0.34, 0.4, 0.6, 0.7].map((share) =>
    analyzeAttack({ chain: attackChain, attackerShare: share, window: 6 })
  );

  const lateChain = simulateChain({
    blocks: Math.min(args.blocks, 50_000),
    seed: args.seed + 2,
    startHeight: 6_300_000,
  });
  const lateAttestation = simulateAttestation({
    chain: lateChain,
    lag: 6,
    window: 6,
  });
  const reputation = analyzeReputation({
    chain: lateChain,
    attestation: lateAttestation,
    rebateRate: 0.1,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        summarize({ chain, attestation, attacks, reputation, lateChain }),
        null,
        2
      )
    );
    return;
  }

  printHeader(args, chain, attackChain, lateChain);
  printMonetarySchedule();
  printBaseline(chain);
  printAttestation(chain, attestation);
  printAttacks(attacks);
  printReputation(reputation, lateChain);
  console.log(`Halving interval: ${HALVING_INTERVAL.toLocaleString()} blocks.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { main, parseArgs, summarize };
