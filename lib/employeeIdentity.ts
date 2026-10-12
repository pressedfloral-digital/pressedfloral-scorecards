// Team members who left and came back (or whose name changed in Rippling) can have
// scorecards under an older spelling of their name. Historical Data folds those into the
// current team member so their history isn't split between Current and Former.

export type NameAliasSource = { linkedEmployeeName?: string; linkedNameAliases?: string[] };

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function prefixCompatible(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

// True when two names look like the same person: identical once case/accents/punctuation
// are ignored, or a shortened form of each part ("Cyd G" ↔ "Cydnei Gay"). The shorter first
// name needs at least 3 letters so "Al" doesn't swallow every Alex and Alyssa.
export function namesLikelySamePerson(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(" ");
  const pb = nb.split(" ");
  if (pa.length < 2 || pb.length < 2) return false;
  const [firstA, lastA] = [pa[0], pa[pa.length - 1]];
  const [firstB, lastB] = [pb[0], pb[pb.length - 1]];
  if (Math.min(firstA.length, firstB.length) < 3) return false;
  return prefixCompatible(firstA, firstB) && prefixCompatible(lastA, lastB);
}

// Maps every former name to the current team member it belongs to. Explicit alternate
// names on app users always win; otherwise a former name is merged only when exactly one
// current team member matches it, so two current Emmas never absorb each other's history.
export function buildCanonicalNameMap(
  names: Iterable<string>,
  currentNames: Set<string>,
  profiles: NameAliasSource[] = []
): Map<string, string> {
  const map = new Map<string, string>();
  const explicit = new Map<string, string>();
  for (const p of profiles) {
    if (!p.linkedEmployeeName) continue;
    for (const alias of p.linkedNameAliases || []) {
      if (alias && alias !== p.linkedEmployeeName) explicit.set(alias, p.linkedEmployeeName);
    }
  }
  const current = Array.from(currentNames);
  for (const name of new Set(names)) {
    if (currentNames.has(name)) continue;
    const aliasTarget = explicit.get(name);
    if (aliasTarget) {
      map.set(name, aliasTarget);
      continue;
    }
    const matches = current.filter((c) => namesLikelySamePerson(name, c));
    if (matches.length === 1) map.set(name, matches[0]);
  }
  return map;
}
