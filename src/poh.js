/**
 * A minimal Proof-of-Hoof ledger used by the Bitcoin lab.
 *
 * It is intentionally chain-agnostic: subjects are opaque strings (miners,
 * blocks, UTXOs, or another project's objects), participants are actors, and
 * rating power is bounded by both attribution and the "stake" that produced
 * it. The lab uses hash share as stake.
 *
 * Growth and recovery are lazy, exactly like the production Solidity ledger:
 * advancing a period is O(1), and a subject or participant is settled only
 * when it is touched. That matters when every Bitcoin block is a subject.
 *
 * This is a research model, not the production implementation.
 */

function normalize(account) {
  return String(account).toLowerCase();
}

export class StasisLedger {
  constructor({ growthRate = 0.02, recoveryRate = 0.5 } = {}) {
    if (growthRate <= 0) throw new Error("growthRate must be > 0");
    if (recoveryRate <= 0) throw new Error("recoveryRate must be > 0");

    this.growthRate = growthRate;
    this.recoveryRate = recoveryRate;
    this.subjects = new Map();
    this.participants = new Map();
    this.attribution = new Map();
    this._period = 0;
  }

  _key(subject, account) {
    return `${normalize(subject)}:${normalize(account)}`;
  }

  _participant(account) {
    const key = normalize(account);
    if (!this.participants.has(key)) {
      this.participants.set(key, {
        stake: 0,
        capacity: 0,
        totalAttribution: 0,
        checkpoint: this._period,
      });
    }
    return this.participants.get(key);
  }

  _subject(subject) {
    const key = normalize(subject);
    if (!this.subjects.has(key)) {
      this.subjects.set(key, { stasis: 0, checkpoint: this._period });
    }
    return this.subjects.get(key);
  }

  _settleSubject(subject) {
    const entry = this._subject(subject);
    const elapsed = this._period - entry.checkpoint;
    if (elapsed <= 0) return entry;
    entry.stasis *= (1 + this.growthRate) ** elapsed;
    entry.checkpoint = this._period;
    return entry;
  }

  _settleParticipant(account) {
    const p = this._participant(account);
    const elapsed = this._period - p.checkpoint;
    if (elapsed <= 0) return p;
    const base = Math.min(p.totalAttribution, p.stake);
    p.capacity += base * this.recoveryRate * elapsed;
    p.checkpoint = this._period;
    return p;
  }

  grantStake(account, amount) {
    if (amount <= 0) throw new Error("stake must be > 0");
    const p = this._settleParticipant(account);
    p.stake += amount;
    p.capacity += amount;
  }

  revokeStake(account, amount) {
    if (amount <= 0) throw new Error("amount must be > 0");
    const p = this._settleParticipant(account);
    if (p.capacity < amount) throw new Error("insufficient capacity");
    if (p.stake < amount) throw new Error("insufficient stake");
    p.stake -= amount;
    p.capacity -= amount;
  }

  /** Advance the global period. Growth and recovery are applied lazily. */
  settle(periods = 1) {
    if (periods <= 0) return;
    this._period += periods;
  }

  rate(account, subject, amount) {
    if (amount <= 0) throw new Error("rating must be > 0");
    const p = this._settleParticipant(account);
    if (p.capacity + 1e-12 < amount) {
      throw new Error("insufficient capacity");
    }
    p.capacity -= amount;
    p.totalAttribution += amount;
    const key = this._key(subject, account);
    this.attribution.set(key, (this.attribution.get(key) || 0) + amount);
    this._settleSubject(subject).stasis += amount;
  }

  stasisOf(subject) {
    return this._settleSubject(subject).stasis;
  }

  capacityOf(account) {
    return this._settleParticipant(account).capacity;
  }

  stakeOf(account) {
    return this._participant(account).stake;
  }

  totalAttributionOf(account) {
    return this._participant(account).totalAttribution;
  }

  attributionOf(subject, account) {
    return this.attribution.get(this._key(subject, account)) || 0;
  }

  totalAttribution() {
    let total = 0;
    for (const p of this.participants.values()) total += p.totalAttribution;
    return total;
  }

  get periods() {
    return this._period;
  }
}
