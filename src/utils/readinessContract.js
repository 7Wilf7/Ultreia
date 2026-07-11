export const READINESS_FIELDS = Object.freeze(["sleep", "legs", "energy"]);

export function formatReadinessValues(readiness = {}) {
  return READINESS_FIELDS
    .filter(key => readiness?.[key] != null && readiness[key] !== "")
    .map(key => `${key}:${readiness[key]}`);
}
