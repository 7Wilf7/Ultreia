export const MEMORY_LIFECYCLE_VERSION = "ultreia_memory.v1";

export const MEMORY_CATEGORIES = [
  "injury_health",
  "goals_races",
  "training_preferences",
  "coaching_style",
  "recurring_patterns",
] as const;

const MEMORY_CATEGORY_SET = new Set<string>(MEMORY_CATEGORIES);
const WRITE_BASES = new Set([
  "explicit_user_statement",
  "repeated_observation",
  "structured_source",
  "explicit_correction",
]);
const ARCHIVE_BASES = new Set(["explicit_correction"]);
const SHORT_TTL_MIN_DAYS = 3;
const SHORT_TTL_MAX_DAYS = 45;
const SHORT_TTL_DEFAULT_DAYS = 14;
const SHORT_RECOVERY_DAYS = 30;

export type MemoryFactRow = {
  id: string;
  client_id?: string | null;
  category?: string | null;
  content_en?: string | null;
  content_zh?: string | null;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
};

export type MemoryDecision = {
  action: "add" | "update" | "archive";
  memoryId: string | null;
  category: string;
  retention: "short" | "long";
  ttlDays: number | null;
  contentEn: string;
  contentZh: string;
  basis: string;
  reason: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return textValue(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/(the|a|an|and|or|to|of|is|are|be|的|了|和|或|是|需要|应该)/g, "");
}

function ngrams(value: string, width = 2): Set<string> {
  const out = new Set<string>();
  if (!value) return out;
  if (value.length <= width) {
    out.add(value);
    return out;
  }
  for (let i = 0; i <= value.length - width; i += 1) out.add(value.slice(i, i + width));
  return out;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

export function memoryTextSimilarity(left: unknown, right: unknown): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return 0.95;
  return jaccard(ngrams(a), ngrams(b));
}

export function parseMemoryDecisionPayload(text: unknown): Record<string, unknown> {
  const raw = textValue(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!raw) throw new Error("empty memory decision");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("invalid memory decision JSON");
    parsed = JSON.parse(raw.slice(start, end + 1));
  }
  const payload = objectValue(parsed);
  if (!Array.isArray(payload.decisions)) throw new Error("memory decisions must be an array");
  return payload;
}

function factKey(fact: MemoryFactRow): string {
  return textValue(fact.id) || textValue(fact.client_id);
}

function findDuplicate(
  category: string,
  contentEn: string,
  contentZh: string,
  facts: MemoryFactRow[],
  exceptId = "",
): MemoryFactRow | null {
  for (const fact of facts) {
    if (factKey(fact) === exceptId || fact.category !== category) continue;
    const score = Math.max(
      memoryTextSimilarity(contentEn, fact.content_en),
      memoryTextSimilarity(contentZh, fact.content_zh),
    );
    if (score >= 0.56) return fact;
  }
  return null;
}

function clampShortTtl(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SHORT_TTL_DEFAULT_DAYS;
  return Math.min(SHORT_TTL_MAX_DAYS, Math.max(SHORT_TTL_MIN_DAYS, Math.round(n)));
}

export function validateMemoryDecisions(
  payload: unknown,
  activeFacts: MemoryFactRow[],
): { accepted: MemoryDecision[]; skipped: Array<{ index: number; reason: string }> } {
  const decisions = Array.isArray(objectValue(payload).decisions) ? objectValue(payload).decisions as unknown[] : [];
  const accepted: MemoryDecision[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  const factMap = new Map(activeFacts.map((fact) => [factKey(fact), fact]));

  decisions.slice(0, 20).forEach((entry, index) => {
    const item = objectValue(entry);
    const action = textValue(item.action);
    if (action === "ignore") {
      skipped.push({ index, reason: "agent_ignore" });
      return;
    }
    if (!(["add", "update", "archive"] as string[]).includes(action)) {
      skipped.push({ index, reason: "invalid_action" });
      return;
    }

    const memoryId = textValue(item.memory_id) || null;
    const existing = memoryId ? factMap.get(memoryId) : null;
    const basis = textValue(item.basis);
    if (action === "archive") {
      if (!existing || !ARCHIVE_BASES.has(basis)) {
        skipped.push({ index, reason: !existing ? "missing_memory" : "archive_basis_not_allowed" });
        return;
      }
      accepted.push({
        action: "archive",
        memoryId,
        category: textValue(existing.category),
        retention: existing.metadata?.memoryTier === "short" ? "short" : "long",
        ttlDays: null,
        contentEn: textValue(existing.content_en),
        contentZh: textValue(existing.content_zh),
        basis,
        reason: textValue(item.reason).slice(0, 300),
      });
      return;
    }

    if (!WRITE_BASES.has(basis)) {
      skipped.push({ index, reason: "write_basis_not_allowed" });
      return;
    }
    if (action === "update" && !existing) {
      skipped.push({ index, reason: "missing_memory" });
      return;
    }

    const category = textValue(item.category) || textValue(existing?.category);
    const contentEn = textValue(item.content_en);
    const contentZh = textValue(item.content_zh);
    const retention = item.retention === "short" ? "short" : item.retention === "long" ? "long" : "";
    if (!MEMORY_CATEGORY_SET.has(category) || !contentEn || !contentZh || !retention) {
      skipped.push({ index, reason: "invalid_content_or_category" });
      return;
    }

    if (findDuplicate(category, contentEn, contentZh, activeFacts, memoryId || "")) {
      skipped.push({ index, reason: "duplicate" });
      return;
    }

    if (existing && basis !== "explicit_correction") {
      const similarity = Math.max(
        memoryTextSimilarity(contentEn, existing.content_en),
        memoryTextSimilarity(contentZh, existing.content_zh),
      );
      const sameRetention = (existing.metadata?.memoryTier === "short" ? "short" : "long") === retention;
      if (similarity >= 0.72 && sameRetention) {
        skipped.push({ index, reason: "cosmetic_update" });
        return;
      }
    }

    accepted.push({
      action: action as "add" | "update",
      memoryId,
      category,
      retention,
      ttlDays: retention === "short" ? clampShortTtl(item.ttl_days) : null,
      contentEn,
      contentZh,
      basis,
      reason: textValue(item.reason).slice(0, 300),
    });
  });

  return { accepted, skipped };
}

export function shortMemoryExpiresAt(baseIso: string, ttlDays: number | null): string | null {
  if (ttlDays == null) return null;
  const base = Date.parse(baseIso);
  if (!Number.isFinite(base)) throw new Error("invalid expiry base date");
  return new Date(base + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

export function memoryDecisionFingerprint(decision: Pick<MemoryDecision, "category" | "contentEn" | "contentZh">): string {
  const input = `${decision.category}|${normalizeText(decision.contentEn)}|${normalizeText(decision.contentZh)}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function expiredShortMemoryFacts(facts: MemoryFactRow[], nowIso: string): MemoryFactRow[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  return facts.filter((fact) => {
    if (fact.metadata?.memoryTier !== "short") return false;
    const expires = Date.parse(textValue(fact.metadata?.expiresAt));
    return Number.isFinite(expires) && expires <= now;
  });
}

export function purgeableShortMemoryFacts(facts: MemoryFactRow[], nowIso: string): MemoryFactRow[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const cutoff = now - SHORT_RECOVERY_DAYS * 24 * 60 * 60 * 1000;
  return facts.filter((fact) => {
    if (fact.status !== "archived" || fact.metadata?.memoryTier !== "short") return false;
    const expiredAt = Date.parse(textValue(fact.metadata?.expiredAt));
    return Number.isFinite(expiredAt) && expiredAt <= cutoff;
  });
}
