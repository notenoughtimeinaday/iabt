import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const tempDir = path.join(root, ".exchange-verify");
const outputFile = path.join(tempDir, "exchange.mjs");

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

try {
  await build({
    entryPoints: [path.join(root, "base44/shared/exchange.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  const exchange = await import(pathToFileURL(outputFile).href + `?t=${Date.now()}`);

  const need = {
    owner_user_id: "founder-1",
    required_capabilities: ["bank partnership development", "payments architecture"],
    mandatory_credentials: ["Texas banking counsel"],
    jurisdictions: ["Texas"],
    project_stage: "regulated_pilot",
    relationship_requested: ["advisor", "institutional_partner"],
    compensation_model: ["paid", "paid_plus_equity"],
  };

  const strongProfile = {
    id: "profile-2",
    user_id: "expert-2",
    user_email: "hidden@example.com",
    public_alias: "Regulated Fintech Advisor",
    headline: "Bank partnerships and payments architecture",
    summary: "Experienced in sponsor-bank diligence and payment program design.",
    phone: "555-0102",
    skills: ["bank partnership development", "payments architecture", "sponsor bank diligence"],
    industries: ["Fintech"],
    jurisdictions: ["Texas", "United States"],
    relationship_types: ["advisor", "institutional_partner"],
    compensation_preferences: ["paid_plus_equity", "paid"],
    availability: "project_based",
    project_stage_preferences: ["regulated_pilot", "beta"],
    visibility: "match_only",
    verification_level: "credential_verified",
    status: "active",
  };

  const verifiedClaims = [{
    verification_status: "verified",
    credential_type: "Texas banking counsel",
    issuing_authority: "State authority",
    jurisdiction: "Texas",
    claim_summary: "Verified professional credential",
  }];

  const strong = exchange.evaluateCandidate(need, strongProfile, verifiedClaims);
  assert.equal(strong.eligible, true, "A fully compatible verified profile should be eligible.");
  assert.ok(strong.total_score >= 85, `Expected a strong match score, received ${strong.total_score}.`);
  assert.deepEqual(Object.keys(strong.score_breakdown), [
    "capability_fit",
    "jurisdiction_credentials",
    "availability",
    "project_stage",
    "relationship_compensation",
    "reputation",
  ]);

  const selfMatch = exchange.evaluateCandidate(need, { ...strongProfile, user_id: "founder-1" }, verifiedClaims);
  assert.equal(selfMatch.eligible, false, "A project owner must never match with their own profile.");
  assert.equal(selfMatch.hard_filter_results.not_self, false);

  const unverified = exchange.evaluateCandidate(need, strongProfile, []);
  assert.equal(unverified.eligible, false, "Mandatory credentials must be verified before eligibility.");
  assert.equal(unverified.hard_filter_results.mandatory_credentials_present, false);

  const hidden = exchange.evaluateCandidate(need, { ...strongProfile, visibility: "private" }, verifiedClaims);
  assert.equal(hidden.eligible, false, "Private profiles must not appear in matching.");
  assert.equal(hidden.hard_filter_results.profile_visible, false);

  const card = exchange.profileCard(strongProfile, verifiedClaims);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "user_email"), false, "Match-safe cards must not contain email.");
  assert.equal(Object.prototype.hasOwnProperty.call(card, "phone"), false, "Match-safe cards must not contain phone.");
  assert.equal(card.public_alias, strongProfile.public_alias);
  assert.equal(card.verified_credentials.length, 1);

  const contact = exchange.disclosedContact(
    { ...strongProfile, organization: "Example Advisory", website: "https://example.com" },
    { full_name: "Example Person", email: "expert@example.com" },
    ["email", "organization"],
  );
  assert.deepEqual(contact, { email: "expert@example.com", organization: "Example Advisory" });

  const sanitizedProfile = exchange.sanitizeProfileInput({
    public_alias: "  Founder Alias  ",
    headline: " Builds products ",
    skills: ["React", "react", "Fintech"],
    relationship_types: ["advisor", "invalid"],
    compensation_preferences: ["paid", "invalid"],
    availability: "project_based",
    project_stage_preferences: ["prototype"],
    visibility: "match_only",
    contact_disclosure_fields: ["email", "invalid"],
    status: "active",
  }, { id: "user-1", email: "owner@example.com", full_name: "Owner" });
  assert.deepEqual(sanitizedProfile.skills, ["React", "Fintech"]);
  assert.deepEqual(sanitizedProfile.relationship_types, ["advisor"]);
  assert.deepEqual(sanitizedProfile.contact_disclosure_fields, ["email"]);

  console.log("IABT Exchange verification passed:");
  console.log("- deterministic matching and weights");
  console.log("- self/private/unverified hard filters");
  console.log("- match-safe profile projection");
  console.log("- consent-limited contact disclosure");
  console.log("- input sanitization and enum enforcement");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
