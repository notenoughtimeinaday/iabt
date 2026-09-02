export const EXCHANGE_VERSION = "iabt-exchange-beta-2026-09-01.1";

export const RELATIONSHIP_TYPES = [
  "cofounder",
  "advisor",
  "paid_contractor",
  "employee",
  "equity_collaborator",
  "institutional_partner",
  "open_to_discussion",
] as const;

export const COMPENSATION_TYPES = [
  "paid",
  "equity",
  "paid_plus_equity",
  "advisory",
  "volunteer",
  "open_to_discussion",
] as const;

export const PROJECT_STAGES = [
  "idea",
  "prototype",
  "beta",
  "revenue",
  "growth",
  "regulated_pilot",
] as const;

export const DISCLOSURE_FIELDS = [
  "full_name",
  "email",
  "phone",
  "organization",
  "calendar_link",
  "linkedin",
  "website",
] as const;

export function text(value: unknown, max = 500, fallback = "") {
  const result = String(value ?? fallback).trim();
  return result.slice(0, max);
}

export function list(value: unknown, max = 30, itemMax = 120) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item, itemMax);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

export function enumList(value: unknown, allowed: readonly string[], max = 20) {
  const allowedSet = new Set(allowed);
  return list(value, max, 80).filter((item) => allowedSet.has(item));
}

export function enumValue(value: unknown, allowed: readonly string[], fallback: string) {
  const candidate = text(value, 80).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

function cleanUrl(value: unknown) {
  const candidate = text(value, 500);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString().slice(0, 500);
  } catch {
    return "";
  }
}

export function sanitizeProfileInput(body: any, user: any, existing: any = null) {
  const createdAt = existing?.created_at || nowIso();
  const profile = {
    user_id: String(user.id),
    user_email: String(user.email),
    public_alias: text(body?.public_alias, 80, existing?.public_alias || user.full_name || "IABT member"),
    headline: text(body?.headline, 160, existing?.headline || "Builder and collaborator"),
    summary: text(body?.summary, 2000, existing?.summary || ""),
    organization: text(body?.organization, 160, existing?.organization || ""),
    phone: text(body?.phone, 60, existing?.phone || ""),
    calendar_link: cleanUrl(body?.calendar_link ?? existing?.calendar_link),
    linkedin: cleanUrl(body?.linkedin ?? existing?.linkedin),
    website: cleanUrl(body?.website ?? existing?.website),
    skills: list(body?.skills ?? existing?.skills, 30, 100),
    industries: list(body?.industries ?? existing?.industries, 20, 100),
    jurisdictions: list(body?.jurisdictions ?? existing?.jurisdictions, 20, 100),
    relationship_types: enumList(body?.relationship_types ?? existing?.relationship_types, RELATIONSHIP_TYPES, 10),
    compensation_preferences: enumList(body?.compensation_preferences ?? existing?.compensation_preferences, COMPENSATION_TYPES, 10),
    availability: enumValue(body?.availability ?? existing?.availability, ["unavailable", "limited", "part_time", "full_time", "project_based"], "project_based"),
    project_stage_preferences: enumList(body?.project_stage_preferences ?? existing?.project_stage_preferences, PROJECT_STAGES, 10),
    visibility: enumValue(body?.visibility ?? existing?.visibility, ["private", "match_only", "discoverable"], "match_only"),
    verification_level: existing?.verification_level || "unverified",
    contact_disclosure_fields: enumList(body?.contact_disclosure_fields ?? existing?.contact_disclosure_fields ?? ["email"], DISCLOSURE_FIELDS, 10),
    status: enumValue(body?.status ?? existing?.status, ["draft", "active", "paused"], "draft"),
    created_at: createdAt,
    updated_at: nowIso(),
  };

  if (!profile.public_alias) throw new Error("A public alias is required.");
  if (!profile.headline) throw new Error("A collaboration headline is required.");
  if (profile.status === "active" && profile.skills.length === 0) {
    throw new Error("Add at least one skill before activating your profile.");
  }
  return profile;
}

export function sanitizeNeedInput(body: any, user: any, existing: any = null) {
  const createdAt = existing?.created_at || nowIso();
  const need = {
    project_id: text(body?.project_id ?? existing?.project_id, 200),
    owner_user_id: String(user.id),
    owner_email: String(user.email),
    title: text(body?.title, 160, existing?.title || "Collaboration need"),
    public_summary: text(body?.public_summary, 2000, existing?.public_summary || ""),
    private_summary: text(body?.private_summary, 5000, existing?.private_summary || ""),
    required_capabilities: list(body?.required_capabilities ?? existing?.required_capabilities, 30, 120),
    mandatory_credentials: list(body?.mandatory_credentials ?? existing?.mandatory_credentials, 20, 160),
    industry: text(body?.industry, 100, existing?.industry || "Other"),
    jurisdictions: list(body?.jurisdictions ?? existing?.jurisdictions, 20, 100),
    project_stage: enumValue(body?.project_stage ?? existing?.project_stage, PROJECT_STAGES, "idea"),
    relationship_requested: enumList(body?.relationship_requested ?? existing?.relationship_requested, RELATIONSHIP_TYPES, 10),
    compensation_model: enumList(body?.compensation_model ?? existing?.compensation_model, COMPENSATION_TYPES, 10),
    time_commitment: text(body?.time_commitment, 200, existing?.time_commitment || ""),
    visibility: enumValue(body?.visibility ?? existing?.visibility, ["private", "match_only", "discoverable"], "match_only"),
    status: enumValue(body?.status ?? existing?.status, ["draft", "active", "paused", "filled", "closed"], "draft"),
    created_at: createdAt,
    updated_at: nowIso(),
  };

  if (!need.title) throw new Error("A need title is required.");
  if (!need.public_summary) throw new Error("A public project summary is required.");
  if (need.status === "active" && need.required_capabilities.length === 0) {
    throw new Error("Add at least one required capability before activating matching.");
  }
  return need;
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(values: unknown[]) {
  const result = new Set<string>();
  for (const value of values || []) {
    const normalized = normalize(value);
    if (!normalized) continue;
    result.add(normalized);
    for (const token of normalized.split(" ")) {
      if (token.length > 2) result.add(token);
    }
  }
  return result;
}

function phraseCoverage(required: string[], offered: string[]) {
  if (!required.length) return 1;
  const offeredNormalized = offered.map(normalize).filter(Boolean);
  const offeredTokens = tokens(offered);
  let matched = 0;
  for (const raw of required) {
    const wanted = normalize(raw);
    if (!wanted) continue;
    const direct = offeredNormalized.some((candidate) =>
      candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate)
    );
    if (direct) {
      matched += 1;
      continue;
    }
    const wantedTokens = wanted.split(" ").filter((item) => item.length > 2);
    if (wantedTokens.length && wantedTokens.every((item) => offeredTokens.has(item))) matched += 1;
  }
  return Math.max(0, Math.min(1, matched / required.length));
}

function intersectionCoverage(required: string[], offered: string[]) {
  if (!required.length) return 1;
  if (!offered.length) return 0;
  const available = new Set(offered.map(normalize));
  const matched = required.map(normalize).filter((item) => available.has(item)).length;
  return Math.max(0, Math.min(1, matched / required.length));
}

function openCompatible(required: string[], offered: string[]) {
  if (!required.length) return true;
  if (!offered.length) return false;
  if (required.includes("open_to_discussion") || offered.includes("open_to_discussion")) return true;
  return intersectionCoverage(required, offered) > 0;
}

function credentialCoverage(required: string[], claims: any[]) {
  if (!required.length) return 1;
  const verified = (claims || [])
    .filter((claim) => claim?.verification_status === "verified")
    .flatMap((claim) => [claim.credential_type, claim.issuing_authority, claim.jurisdiction, claim.claim_summary])
    .map(normalize)
    .filter(Boolean);
  if (!verified.length) return 0;
  let matched = 0;
  for (const item of required) {
    const wanted = normalize(item);
    if (verified.some((candidate) => candidate.includes(wanted) || wanted.includes(candidate))) matched += 1;
  }
  return matched / required.length;
}

function availabilityScore(value: string) {
  return ({ full_time: 1, project_based: 0.9, part_time: 0.8, limited: 0.45, unavailable: 0 } as Record<string, number>)[value] ?? 0.6;
}

function reputationScore(profile: any, claims: any[]) {
  const verifiedClaims = (claims || []).filter((claim) => claim?.verification_status === "verified").length;
  const level = ({
    unverified: 0.2,
    identity_verified: 0.55,
    credential_verified: 0.85,
    organization_verified: 1,
  } as Record<string, number>)[profile?.verification_level] ?? 0.2;
  return Math.min(1, level + Math.min(0.2, verifiedClaims * 0.05));
}

export function evaluateCandidate(need: any, profile: any, claims: any[] = []) {
  const hardFilters = {
    not_self: String(need?.owner_user_id || "") !== String(profile?.user_id || ""),
    profile_active: profile?.status === "active",
    profile_visible: profile?.visibility !== "private",
    available: profile?.availability !== "unavailable",
    relationship_compatible: openCompatible(need?.relationship_requested || [], profile?.relationship_types || []),
    compensation_compatible: openCompatible(need?.compensation_model || [], profile?.compensation_preferences || []),
    jurisdiction_compatible: !(need?.jurisdictions || []).length || intersectionCoverage(need.jurisdictions, profile?.jurisdictions || []) > 0,
    mandatory_credentials_present: credentialCoverage(need?.mandatory_credentials || [], claims) >= 1,
  };
  const eligible = Object.values(hardFilters).every(Boolean);

  const capability = phraseCoverage(need?.required_capabilities || [], profile?.skills || []);
  const jurisdiction = intersectionCoverage(need?.jurisdictions || [], profile?.jurisdictions || []);
  const credentials = credentialCoverage(need?.mandatory_credentials || [], claims);
  const jurisdictionCredentials = ((jurisdiction * 0.5) + (credentials * 0.5));
  const availability = availabilityScore(profile?.availability);
  const stage = intersectionCoverage([need?.project_stage].filter(Boolean), profile?.project_stage_preferences || []);
  const relationship = intersectionCoverage(need?.relationship_requested || [], profile?.relationship_types || []);
  const compensation = intersectionCoverage(need?.compensation_model || [], profile?.compensation_preferences || []);
  const relationshipCompensation = ((relationship * 0.6) + (compensation * 0.4));
  const reputation = reputationScore(profile, claims);

  const breakdown = {
    capability_fit: Math.round(capability * 35),
    jurisdiction_credentials: Math.round(jurisdictionCredentials * 20),
    availability: Math.round(availability * 15),
    project_stage: Math.round(stage * 15),
    relationship_compensation: Math.round(relationshipCompensation * 10),
    reputation: Math.round(reputation * 5),
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + Number(value || 0), 0);

  const strengths: string[] = [];
  if (breakdown.capability_fit >= 25) strengths.push("strong capability overlap");
  if (breakdown.jurisdiction_credentials >= 14) strengths.push("jurisdiction or credential alignment");
  if (breakdown.availability >= 11) strengths.push("compatible availability");
  if (breakdown.project_stage >= 11) strengths.push("project-stage fit");
  if (breakdown.relationship_compensation >= 7) strengths.push("compatible working relationship");
  if (breakdown.reputation >= 4) strengths.push("verified reputation signals");

  return {
    eligible,
    total_score: Math.max(0, Math.min(100, total)),
    score_breakdown: breakdown,
    hard_filter_results: hardFilters,
    explanation: strengths.length
      ? `Potential match based on ${strengths.join(", ")}. Review the full score and request a mutual-consent introduction before sharing private information.`
      : "This profile passed the required filters but has limited measured overlap. Review carefully before requesting an introduction.",
  };
}

export function profileCard(profile: any, claims: any[] = []) {
  return {
    profile_id: String(profile?.id || ""),
    public_alias: text(profile?.public_alias, 80, "Anonymous collaborator"),
    headline: text(profile?.headline, 160),
    summary: text(profile?.summary, 600),
    skills: list(profile?.skills, 20, 100),
    industries: list(profile?.industries, 12, 100),
    jurisdictions: list(profile?.jurisdictions, 12, 100),
    relationship_types: enumList(profile?.relationship_types, RELATIONSHIP_TYPES, 10),
    compensation_preferences: enumList(profile?.compensation_preferences, COMPENSATION_TYPES, 10),
    availability: text(profile?.availability, 80),
    project_stage_preferences: enumList(profile?.project_stage_preferences, PROJECT_STAGES, 10),
    verification_level: text(profile?.verification_level, 80, "unverified"),
    verified_credentials: (claims || [])
      .filter((claim) => claim?.verification_status === "verified")
      .map((claim) => ({
        credential_type: text(claim.credential_type, 160),
        jurisdiction: text(claim.jurisdiction, 120),
        issuing_authority: text(claim.issuing_authority, 200),
      }))
      .slice(0, 10),
  };
}

export function disclosedContact(profile: any, user: any, fields: string[]) {
  const allowed = new Set(enumList(fields, DISCLOSURE_FIELDS, 10));
  const result: Record<string, string> = {};
  if (allowed.has("full_name")) result.full_name = text(user?.full_name || user?.name, 160);
  if (allowed.has("email")) result.email = text(user?.email || profile?.user_email, 240);
  if (allowed.has("phone")) result.phone = text(profile?.phone, 60);
  if (allowed.has("organization")) result.organization = text(profile?.organization, 160);
  if (allowed.has("calendar_link")) result.calendar_link = cleanUrl(profile?.calendar_link);
  if (allowed.has("linkedin")) result.linkedin = cleanUrl(profile?.linkedin);
  if (allowed.has("website")) result.website = cleanUrl(profile?.website);
  return Object.fromEntries(Object.entries(result).filter(([, value]) => Boolean(value)));
}

export function ownsProject(user: any, project: any) {
  return Boolean(project && (
    user?.role === "admin" ||
    String(project?.user_id || "") === String(user?.id || "") ||
    String(project?.created_by || "") === String(user?.email || "")
  ));
}

export async function activeBlockExists(service: any, leftUserId: string, rightUserId: string) {
  const [left, right] = await Promise.all([
    service.entities.ExchangeBlock.filter({ blocker_user_id: leftUserId, blocked_user_id: rightUserId, status: "active" }, "-created_at", 1).catch(() => []),
    service.entities.ExchangeBlock.filter({ blocker_user_id: rightUserId, blocked_user_id: leftUserId, status: "active" }, "-created_at", 1).catch(() => []),
  ]);
  return Boolean(left?.length || right?.length);
}

export async function auditExchange(service: any, event: {
  actor_user_id: string;
  participant_a_user_id?: string;
  participant_b_user_id?: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    return await service.entities.ExchangeAuditEvent.create({
      actor_user_id: event.actor_user_id,
      participant_a_user_id: event.participant_a_user_id || "",
      participant_b_user_id: event.participant_b_user_id || "",
      event_type: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      summary: text(event.summary, 1000),
      metadata: event.metadata || {},
      created_at: nowIso(),
    });
  } catch (error) {
    console.error("IABT Exchange audit write failed:", error);
    return null;
  }
}

export function sanitizeMessage(value: unknown) {
  const message = text(value, 5000);
  if (!message) throw new Error("Write a message before sending.");
  return message;
}
