/**
 * A deliberately small Bitcoin model.
 *
 * It is not a node and not a consensus implementation. It models the monetary
 * schedule and the block-production surface that the PoH overlay needs:
 * halvings, subsidy, fees, difficulty retargets, and miner shares.
 */

export const HALVING_INTERVAL = 210_000;
export const INITIAL_SUBSIDY = 50;
export const BLOCK_INTERVAL_SECONDS = 600;
export const MAX_MONEY = 21_000_000;
export const RETARGET_INTERVAL = 2_016;

export function halvingEpoch(height) {
  return Math.floor(height / HALVING_INTERVAL);
}

export function subsidyAt(height) {
  if (!Number.isFinite(height) || height < 0) {
    throw new Error("height must be a non-negative number");
  }
  const epoch = halvingEpoch(height);
  if (epoch >= 33) return 0;
  return INITIAL_SUBSIDY / 2 ** epoch;
}

/**
 * A saturating fee curve. Fees grow with adoption for the first few halving
 * epochs and then plateau. This avoids the absurd exponential blow-up of a
 * naive `base * growth^epoch` model while still letting fees dominate the
 * subsidy in the late chain.
 */
export function feeAt(
  height,
  { base = 0.2, growth = 0.5, plateauEpoch = 8 } = {}
) {
  if (height < 0) throw new Error("height must be >= 0");
  const epoch = Math.min(halvingEpoch(height), plateauEpoch);
  return base * (1 + growth * epoch);
}

export function blockReward(height, feeOptions) {
  return subsidyAt(height) + feeAt(height, feeOptions);
}

export function totalSupplyAt(height) {
  if (height < 0) throw new Error("height must be >= 0");
  let supply = 0;
  for (let epoch = 0; epoch < 33; epoch += 1) {
    const start = epoch * HALVING_INTERVAL;
    if (start >= height) break;
    const end = Math.min((epoch + 1) * HALVING_INTERVAL, height);
    supply += (end - start) * subsidyAt(start);
  }
  return supply;
}

/**
 * Bitcoin's difficulty retarget is clamped to a factor of four in either
 * direction. This function keeps that shape without pretending to model the
 * full timestamp rules.
 */
export function retargetDifficulty(previousDifficulty, actualSeconds) {
  if (previousDifficulty <= 0) throw new Error("difficulty must be > 0");
  if (actualSeconds <= 0) throw new Error("actualSeconds must be > 0");
  const targetSeconds = RETARGET_INTERVAL * BLOCK_INTERVAL_SECONDS;
  const raw = previousDifficulty * (targetSeconds / actualSeconds);
  const lower = previousDifficulty / 4;
  const upper = previousDifficulty * 4;
  return Math.min(upper, Math.max(lower, raw));
}

/**
 * A tiny deterministic PRNG. Same seed, same lab run.
 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

export function pickWeighted(items, weightOf, random) {
  const roll = random();
  let cursor = 0;
  for (const item of items) {
    cursor += weightOf(item);
    if (roll < cursor) return item;
  }
  return items[items.length - 1];
}

export function halvingSchedule(epochs = 6) {
  const rows = [];
  let supply = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const height = epoch * HALVING_INTERVAL;
    const subsidy = subsidyAt(height);
    if (epoch > 0) supply += HALVING_INTERVAL * subsidyAt((epoch - 1) * HALVING_INTERVAL);
    rows.push({
      epoch,
      height,
      subsidy,
      supplyAfterEpoch: supply + HALVING_INTERVAL * subsidy,
    });
  }
  return rows;
}
