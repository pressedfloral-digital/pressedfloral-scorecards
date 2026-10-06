import type { ActualsByKey, AppData, Employee, Goal, Scorecard } from "./types";

export const GOAL_BANK_KEY = "goal-bank-v1";
export const ACTUALS_PREFIX = "actuals-v1:";
export const RIPPLING_PREFIX = "rippling:";
export const RIPPLING_MONTHS_INDEX = "rippling-months-index";
export const SCORECARDS_PREFIX = "scorecards:";
export const SCORECARDS_MONTHS_INDEX = "scorecards-months-index";
export const MONTH_TARGETS_PREFIX = "bank-month-targets:";
export const PROFILE_EMAIL_KEY = "pf-current-email";
export const PROFILE_ROLE_KEY = "pf-current-role";
export const TODO_COUNT_KEY = "pf-todo-count";

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  if (!canUseStorage()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function persistGoals(goals: Goal[]) {
  writeJson(GOAL_BANK_KEY, goals);
}

export function persistActuals(period: string, actuals: ActualsByKey) {
  writeJson(`${ACTUALS_PREFIX}${period}`, actuals);
}

export function persistRippling(month: string, employees: Employee[]) {
  writeJson(`${RIPPLING_PREFIX}${month}`, employees);
  const months = readJson<string[]>(RIPPLING_MONTHS_INDEX, []);
  if (!months.includes(month)) writeJson(RIPPLING_MONTHS_INDEX, [...months, month].sort());
}

export function removePersistedRippling(month: string) {
  if (!canUseStorage()) return;
  try { window.localStorage.removeItem(`${RIPPLING_PREFIX}${month}`); } catch { /* storage unavailable */ }
  const months = readJson<string[]>(RIPPLING_MONTHS_INDEX, []);
  writeJson(RIPPLING_MONTHS_INDEX, months.filter((m) => m !== month));
}

export function persistScorecard(scorecard: Scorecard) {
  const key = `${SCORECARDS_PREFIX}${scorecard.scorecardMonth}`;
  const existing = readJson<Scorecard[]>(key, []);
  writeJson(key, [...existing.filter((item) => item.id !== scorecard.id), scorecard]);
  const months = readJson<string[]>(SCORECARDS_MONTHS_INDEX, []);
  if (!months.includes(scorecard.scorecardMonth)) writeJson(SCORECARDS_MONTHS_INDEX, [...months, scorecard.scorecardMonth]);
}

export function hydrateFromLocalStorage(fallback: AppData): AppData {
  if (!canUseStorage()) return fallback;
  const goals = readJson<Goal[]>(GOAL_BANK_KEY, fallback.goals);
  const actuals = { ...fallback.actuals };
  const rippling = { ...fallback.rippling };
  const scorecards = [...fallback.scorecards];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) || "";
    if (key.startsWith(ACTUALS_PREFIX)) actuals[key.replace(ACTUALS_PREFIX, "")] = readJson(key, {});
    if (key.startsWith(RIPPLING_PREFIX)) rippling[key.replace(RIPPLING_PREFIX, "")] = readJson(key, []);
    if (key.startsWith(SCORECARDS_PREFIX)) {
      const items = readJson<Scorecard[]>(key, []);
      for (const item of items) if (!scorecards.some((existing) => existing.id === item.id)) scorecards.push(item);
    }
  }

  return { ...fallback, goals, actuals, rippling, scorecards };
}

