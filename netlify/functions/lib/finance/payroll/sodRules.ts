// ============================================================================
// Finance — Payroll SoD rules (PURE)
// ============================================================================
// The segregation-of-duties maths, deliberately free of any database import so
// it can be unit-tested directly. sodPolicy.ts supplies the data (who holds
// which seat) and this module decides what the rules mean.
//
//   level 2 -> funder/releaser must differ from the preparer
//   level 3 -> ... and from the approver              (default)
//   level 4 -> ... and from the certifier             (strictest)
//
// The floor is 2: the preparer can never fund or release their own run, and the
// approver can never be the preparer.
// ============================================================================

export const SOD_LEVELS = [2, 3, 4] as const;
export type SodLevel = (typeof SOD_LEVELS)[number];

export type SodSeatKey = 'prepare' | 'certify' | 'approve' | 'fund' | 'release';

/** The lifecycle seats, keyed to the SAME permissions the release-chain RPCs
 *  enforce — so anything derived from this cannot drift from the database. */
export const CHAIN_SEATS: { key: SodSeatKey; label: string; detail: string; permission: string }[] = [
  { key: 'prepare', label: 'Prepare',  detail: 'Creates the run, locks inputs and calculates it.',          permission: 'finance.payroll.run.manage' },
  { key: 'certify', label: 'Certify',  detail: 'Attests the calculation, statutory results and variances.', permission: 'finance.payroll.certify' },
  { key: 'approve', label: 'Approve',  detail: 'Decides the approval task and locks the run.',              permission: 'finance.payroll.approve' },
  { key: 'fund',    label: 'Fund',     detail: 'Confirms the money is available against net pay.',          permission: 'finance.payroll.funding.approve' },
  { key: 'release', label: 'Release',  detail: 'Issues the release certificate and pays employees.',        permission: 'finance.payroll.release' },
];

/**
 * Seats that must be held by DISTINCT people at each level. Fund and release are
 * ONE seat here because the RPCs never separate those two from each other — only
 * from prepare/approve/certify — so the same person may do both.
 */
export const DISTINCT_SEATS: Record<SodLevel, SodSeatKey[]> = {
  2: ['prepare', 'fund'],
  3: ['prepare', 'approve', 'fund'],
  4: ['prepare', 'certify', 'approve', 'fund'],
};

/** Which earlier seats a seat must be a different person from, at `level`. */
export function separationFor(key: SodSeatKey, level: SodLevel): SodSeatKey[] {
  // The approver can never be the preparer — the 2-person floor, every level.
  if (key === 'approve') return ['prepare'];
  if (key === 'fund' || key === 'release') {
    const from: SodSeatKey[] = ['prepare'];                 // floor
    if (level >= 3) from.push('approve');
    if (level >= 4) from.push('certify');
    return from;
  }
  return [];
}

/**
 * Largest set of distinct people that can cover `seats`, given each seat's
 * eligible holders — a maximum bipartite matching (Kuhn's algorithm).
 *
 * A headcount check would be WRONG: five people who can all only prepare do not
 * make level 4 achievable. Only a matching answers "can these seats be staffed by
 * different people at the same time". At most 4 seats, so this is trivially cheap.
 */
export function maxDistinctAssignment(
  seats: SodSeatKey[],
  holdersBySeat: Map<SodSeatKey, string[]>,
): { size: number; unmatched: SodSeatKey[] } {
  const assignedTo = new Map<string, SodSeatKey>();          // person -> seat
  const unmatched: SodSeatKey[] = [];

  const tryAssign = (seat: SodSeatKey, seen: Set<string>): boolean => {
    for (const person of holdersBySeat.get(seat) ?? []) {
      if (seen.has(person)) continue;
      seen.add(person);
      const holder = assignedTo.get(person);
      // Free, or its current seat can be re-staffed by someone else.
      if (holder === undefined || tryAssign(holder, seen)) {
        assignedTo.set(person, seat);
        return true;
      }
    }
    return false;
  };

  for (const seat of seats) {
    if (!tryAssign(seat, new Set())) unmatched.push(seat);
  }
  return { size: seats.length - unmatched.length, unmatched };
}

export interface SodLevelFeasibility {
  level: SodLevel;
  required: number;
  available: number;
  feasible: boolean;
  shortfallSeats: SodSeatKey[];
  separations: { seat: SodSeatKey; mustDifferFrom: SodSeatKey[] }[];
}

/**
 * Can each level actually be staffed by the given holders? Proposing a level the
 * org cannot fill would strand every future run at funding with PR403 — the very
 * deadlock this feature exists to remove — so this backs a real gate, not a hint.
 */
export function computeFeasibility(
  holdersBySeat: Map<SodSeatKey, string[]>,
): SodLevelFeasibility[] {
  return SOD_LEVELS.map(level => {
    const seats = DISTINCT_SEATS[level];
    const { size, unmatched } = maxDistinctAssignment(seats, holdersBySeat);
    return {
      level,
      required: seats.length,
      available: size,
      feasible: size >= seats.length,
      shortfallSeats: unmatched,
      separations: CHAIN_SEATS.map(s => ({ seat: s.key, mustDifferFrom: separationFor(s.key, level) })),
    };
  });
}
