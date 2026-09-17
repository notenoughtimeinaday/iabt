import {
  EXCHANGE_VERSION, DISCLOSURE_FIELDS, sanitizeProfileInput, sanitizeNeedInput,
  evaluateCandidate, profileCard, disclosedContact, enumList, text, list, nowIso
} from "./exchange-policy.js";

export const EXCHANGE_FUNCTIONS = new Set([
  "get-exchange-dashboard", "save-exchange-profile", "save-project-need",
  "analyze-project-needs", "find-collaboration-matches", "request-introduction",
  "respond-to-introduction", "get-collaboration-room", "send-collaboration-message",
  "save-credential-claim", "block-exchange-user", "report-exchange-user",
  "get-exchange-admin", "admin-review-exchange"
]);

const fail = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};
const requireValue = (value, name, max = 200) => {
  const result = text(value, max);
  if (!result) fail(400, "invalid_exchange_input", `${name} is required`);
  return result;
};
const isOwner = (row, user, field = "owner_user_id") =>
  Boolean(row && row.owner_id === user.id && row[field] === user.id);
const isMember = (room, user) =>
  Boolean(room && [room.member_a_user_id, room.member_b_user_id].includes(user.id));
const expired = (row) => Boolean(row?.expires_at && !(new Date(row.expires_at).getTime() > Date.now()));
const unique = (rows) => [...new Map(rows.map((row) => [row.id, row])).values()];
const safeNeed = (need, own = false) => need ? {
  id: need.id, project_id: own ? need.project_id || "" : "", title: text(need.title, 160),
  public_summary: text(need.public_summary, 2000),
  ...(own ? { private_summary: text(need.private_summary, 5000) } : {}),
  required_capabilities: list(need.required_capabilities), mandatory_credentials: list(need.mandatory_credentials),
  industry: text(need.industry, 100), jurisdictions: list(need.jurisdictions), project_stage: need.project_stage,
  relationship_requested: list(need.relationship_requested), compensation_model: list(need.compensation_model),
  time_commitment: text(need.time_commitment, 200), visibility: need.visibility, status: need.status,
  created_at: need.created_at, updated_at: need.updated_at
} : null;
const safeMessage = (message, user) => ({
  id: message.id, sender_user_id: message.sender_user_id, sender_alias: text(message.sender_alias, 80),
  message: text(message.message, 5000), attachment_ids: [], created_at: message.created_at,
  edited_at: message.edited_at || null, status: message.status, mine: message.sender_user_id === user.id
});

// This privileged facade is private to this module. Callers never supply its
// identity, role, query or entity name. Every outward response below has an
// explicit owner/member/admin policy and a deliberately limited field set.
const records = (repository, user) => {
  const service = { id: user.id, role: "admin" };
  const all = (entity, query = {}, limit = 500, sort = "-created_date") =>
    repository.listRecordsExact(entity, service, { query, limit, sort });
  const get = (entity, id) => repository.getRecord(entity, String(id || ""), service);
  const create = (entity, input, ownerId = user.id) =>
    repository.createRecord(entity, { id: ownerId, role: "user" }, input);
  const update = (entity, id, input) => repository.updateRecord(entity, id, service, input);
  const profile = async (userId) => (await all("CollaborationProfile", { owner_id: userId, user_id: userId }, 1, "-updated_at"))[0] || null;
  const claims = async (userId) => (await all("CredentialClaim", { owner_id: userId, user_id: userId }, 200))
    .filter((claim) => claim.owner_id === userId && !expired(claim));
  const blocked = async (left, right) => {
    const [a, b] = await Promise.all([
      all("ExchangeBlock", { owner_id: left, blocker_user_id: left, blocked_user_id: right, status: "active" }, 1),
      all("ExchangeBlock", { owner_id: right, blocker_user_id: right, blocked_user_id: left, status: "active" }, 1)
    ]);
    return Boolean(a.length || b.length);
  };
  const audit = (event, entity, row, metadata = {}) => create("ExchangeAuditEvent", {
    actor_user_id: user.id, event_type: event, entity_type: entity, entity_id: row.id,
    participant_a_user_id: row.requester_user_id || row.member_a_user_id || row.user_id || user.id,
    participant_b_user_id: row.recipient_user_id || row.member_b_user_id || row.reported_user_id || "",
    summary: event.replaceAll("_", " "), metadata, created_at: nowIso()
  });
  return { all, get, create, update, profile, claims, blocked, audit };
};

const ownNeed = async (db, user, id) => {
  const need = await db.get("ProjectNeed", id);
  if (!isOwner(need, user)) fail(404, "need_not_found", "Project need not found or access denied");
  return need;
};
const ownedProject = async (repository, user, id) => {
  const project = await repository.getRecord("Project", id, { id: user.id, role: "user" });
  if (!project) fail(404, "project_not_found", "Project not found or access denied");
  return project;
};
const availableProfile = (profile) => Boolean(profile?.status === "active" && profile.visibility !== "private" && profile.availability !== "unavailable");
const safeCard = (profile, claims) => profileCard({
  ...profile,
  // Verified credentials expire or can be revoked. Never retain a stale badge.
  verification_level: profile.verification_level === "credential_verified" &&
    !claims.some((claim) => claim.verification_status === "verified" && !expired(claim))
    ? "unverified" : profile.verification_level
}, claims.filter((claim) => !expired(claim)));

async function dashboard(db, repository, user) {
  const [profile, needs, ownMatches, outgoing, incoming, aRooms, bRooms, credentials, reports, blocks, projects] = await Promise.all([
    db.profile(user.id), db.all("ProjectNeed", { owner_user_id: user.id }, 100, "-updated_at"),
    db.all("MatchRecord", { owner_user_id: user.id }, 250, "-generated_at"),
    db.all("IntroductionRequest", { requester_user_id: user.id }, 100, "-requested_at"),
    db.all("IntroductionRequest", { recipient_user_id: user.id }, 100, "-requested_at"),
    db.all("CollaborationRoom", { member_a_user_id: user.id }, 100, "-last_message_at"),
    db.all("CollaborationRoom", { member_b_user_id: user.id }, 100, "-last_message_at"),
    db.all("CredentialClaim", { user_id: user.id }, 100),
    db.all("ExchangeSafetyReport", { reporter_user_id: user.id }, 100),
    db.all("ExchangeBlock", { blocker_user_id: user.id, status: "active" }, 100),
    repository.listRecords("Project", { id: user.id, role: "user" }, { limit: 250, sort: "-updated_date" })
  ]);
  const matches = [];
  for (const match of ownMatches) {
    if (!isOwner(match, user) || expired(match) || match.status === "expired") continue;
    const [candidate, need] = await Promise.all([
      db.get("CollaborationProfile", match.candidate_profile_id), db.get("ProjectNeed", match.project_need_id)
    ]);
    if (!isOwner(need, user) || need.status !== "active" || !availableProfile(candidate) ||
        candidate.owner_id !== match.candidate_user_id || await db.blocked(user.id, match.candidate_user_id)) continue;
    const candidateClaims = await db.claims(match.candidate_user_id);
    if (!evaluateCandidate(need, candidate, candidateClaims).eligible) continue;
    matches.push({
      id: match.id, project_need_id: match.project_need_id, candidate_user_id: match.candidate_user_id,
      total_score: match.total_score, score_breakdown: match.score_breakdown,
      hard_filter_results: match.hard_filter_results, ai_explanation: text(match.ai_explanation, 2000),
      status: match.status, generated_at: match.generated_at, candidate: safeCard(candidate, candidateClaims)
    });
  }
  const introductions = [];
  for (const intro of unique([...outgoing, ...incoming])) {
    if (intro.owner_id !== intro.requester_user_id) continue;
    const need = await db.get("ProjectNeed", intro.project_need_id);
    if (!need || need.owner_id !== intro.requester_user_id || need.owner_user_id !== intro.requester_user_id) continue;
    const [requester, recipient] = await Promise.all([db.profile(intro.requester_user_id), db.profile(intro.recipient_user_id)]);
    const introductionCard = async (current, snapshot) => availableProfile(current)
      ? safeCard(current, await db.claims(current.user_id))
      : safeCard({ ...snapshot, id: snapshot?.profile_id, verification_level: "unverified" }, []);
    introductions.push({
      id: intro.id, match_id: intro.match_id, project_need_id: intro.project_need_id,
      direction: intro.requester_user_id === user.id ? "outgoing" : "incoming",
      request_message: text(intro.request_message, 2000), status: expired(intro) && intro.status === "pending" ? "expired" : intro.status,
      requester_disclosure_consent: intro.requester_disclosure_consent === true,
      recipient_disclosure_consent: intro.recipient_disclosure_consent === true,
      requester_disclosure_fields: enumList(intro.requester_disclosure_fields, [...DISCLOSURE_FIELDS, "private_project_summary"]),
      recipient_disclosure_fields: enumList(intro.recipient_disclosure_fields, DISCLOSURE_FIELDS),
      requester_snapshot: await introductionCard(requester, intro.requester_snapshot),
      recipient_snapshot: await introductionCard(recipient, intro.recipient_snapshot),
      need: safeNeed(need), requested_at: intro.requested_at, responded_at: intro.responded_at || null
    });
  }
  const rooms = [];
  for (const room of unique([...aRooms, ...bRooms])) {
    if (room.owner_id !== room.member_a_user_id) continue;
    const need = await db.get("ProjectNeed", room.project_need_id);
    if (!need || need.owner_id !== room.member_a_user_id || need.owner_user_id !== room.member_a_user_id) continue;
    const otherId = room.member_a_user_id === user.id ? room.member_b_user_id : room.member_a_user_id;
    rooms.push({
      id: room.id, project_id: "", project_need_id: room.project_need_id, status: room.status,
      other_user_id: otherId, other_alias: text(room.member_aliases?.[otherId], 80, "Collaborator"),
      need: safeNeed(need), created_at: room.created_at, last_message_at: room.last_message_at
    });
  }
  return {
    beta: true, profile, needs: needs.filter((need) => isOwner(need, user)).map((need) => safeNeed(need, true)), matches, introductions, rooms,
    credentials: credentials.filter((claim) => isOwner(claim, user, "user_id")),
    safety_reports: reports.map((report) => ({ id: report.id, reason: report.reason, description: report.description, status: report.status, created_at: report.created_at })),
    blocks: blocks.map((block) => ({ id: block.id, blocked_user_id: block.blocked_user_id, reason: block.reason, created_at: block.created_at })),
    projects: projects.map((project) => ({ id: project.id, title: text(project.title, 100), description: text(project.description, 500), category: project.category, status: project.status })),
    counts: { active_needs: needs.filter((need) => need.status === "active").length, suggested_matches: matches.filter((match) => ["suggested", "saved"].includes(match.status)).length, incoming_introductions: introductions.filter((intro) => intro.direction === "incoming" && intro.status === "pending").length, active_rooms: rooms.filter((room) => room.status === "active").length },
    privacy: { matching_is_opt_in: true, public_directory_enabled: false, identity_disclosed_before_consent: false, private_project_summary_disclosed_before_consent: false }
  };
}

async function findMatches(db, user, body) {
  const need = await ownNeed(db, user, requireValue(body.project_need_id, "project_need_id"));
  if (need.status !== "active" || need.visibility === "private") fail(400, "need_not_active", "Activate matching and choose match visibility for this project need");
  const [profiles, previous, ownBlocks, reverseBlocks, verifiedClaims] = await Promise.all([
    db.all("CollaborationProfile", { status: "active" }, 500, "-updated_at"),
    db.all("MatchRecord", { project_need_id: need.id }, 500),
    db.all("ExchangeBlock", { owner_id: user.id, blocker_user_id: user.id, status: "active" }, 5000),
    db.all("ExchangeBlock", { blocked_user_id: user.id, status: "active" }, 5000),
    db.all("CredentialClaim", { verification_status: "verified" }, 5000, "-verified_at")
  ]);
  if (ownBlocks.length === 5000 || reverseBlocks.length === 5000) fail(503, "exchange_block_scan_incomplete", "Matching cannot verify the complete block list; contact support");
  const blockedUsers = new Set([
    ...ownBlocks.map((block) => block.blocked_user_id),
    ...reverseBlocks.filter((block) => block.owner_id === block.blocker_user_id).map((block) => block.blocker_user_id)
  ]);
  const claimsByUser = new Map();
  for (const claim of verifiedClaims) {
    if (claim.owner_id !== claim.user_id || expired(claim)) continue;
    if (!claimsByUser.has(claim.user_id)) claimsByUser.set(claim.user_id, []);
    claimsByUser.get(claim.user_id).push(claim);
  }
  const ranked = [];
  for (const profile of profiles) {
    if (profile.owner_id !== profile.user_id || profile.user_id === user.id || !availableProfile(profile) || blockedUsers.has(profile.user_id)) continue;
    const claims = claimsByUser.get(profile.user_id) || [];
    const candidate = { ...profile, verification_level: safeCard(profile, claims).verification_level };
    const evaluation = evaluateCandidate(need, candidate, claims);
    if (evaluation.eligible) ranked.push({ profile: candidate, claims, evaluation });
  }
  ranked.sort((a, b) => b.evaluation.total_score - a.evaluation.total_score || a.profile.id.localeCompare(b.profile.id));
  const matches = [];
  for (const { profile, claims, evaluation } of ranked.slice(0, 25)) {
    const existing = previous.find((match) => match.candidate_user_id === profile.user_id);
    const payload = {
      project_need_id: need.id, owner_user_id: user.id, candidate_profile_id: profile.id, candidate_user_id: profile.user_id,
      total_score: evaluation.total_score, score_breakdown: evaluation.score_breakdown, hard_filter_results: evaluation.hard_filter_results, ai_explanation: evaluation.explanation,
      status: existing && ["saved", "introduction_requested", "connected"].includes(existing.status) ? existing.status : "suggested",
      generated_at: nowIso(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
    };
    const saved = existing ? await db.update("MatchRecord", existing.id, payload) : await db.create("MatchRecord", payload);
    matches.push({ ...payload, id: saved.id, candidate: safeCard(profile, claims) });
  }
  for (const match of previous) {
    if (!matches.some((candidate) => candidate.id === match.id) && ["suggested", "saved"].includes(match.status)) await db.update("MatchRecord", match.id, { status: "expired" });
  }
  await db.audit("matches_generated", "ProjectNeed", need, { match_count: matches.length });
  return { algorithm: { name: "deterministic_weighted_v1", weights: { capability_fit: 35, jurisdiction_credentials: 20, availability: 15, project_stage: 15, relationship_compensation: 10, reputation: 5 }, random_selection: false }, project_need: { id: need.id, title: need.title }, matches, match_count: matches.length, candidate_scan_limit: 500, credential_scan_limit: 5000, candidate_scan_incomplete: profiles.length === 500 || verifiedClaims.length === 5000, privacy: "Contact fields are available only inside mutually accepted rooms." };
}

async function requestIntroduction(db, user, body) {
  const match = await db.get("MatchRecord", requireValue(body.match_id, "match_id"));
  if (!isOwner(match, user)) fail(404, "match_not_found", "Match not found or access denied");
  if (!["suggested", "saved"].includes(match.status) || expired(match)) fail(409, "match_not_available", "Refresh matching before requesting an introduction");
  const [need, requester, recipient] = await Promise.all([
    ownNeed(db, user, match.project_need_id), db.profile(user.id), db.get("CollaborationProfile", match.candidate_profile_id)
  ]);
  if (!availableProfile(requester) || !availableProfile(recipient) || recipient.owner_id !== match.candidate_user_id || recipient.user_id !== match.candidate_user_id || need.status !== "active" || need.visibility === "private") fail(409, "collaboration_unavailable", "An active, visible project need and two active profiles are required");
  if (await db.blocked(user.id, recipient.user_id)) fail(403, "exchange_blocked", "An introduction is unavailable between these accounts");
  const [requesterClaims, recipientClaims, existing] = await Promise.all([
    db.claims(user.id), db.claims(recipient.user_id), db.all("IntroductionRequest", { match_id: match.id }, 100)
  ]);
  if (!evaluateCandidate(need, recipient, recipientClaims).eligible) fail(409, "match_not_eligible", "This collaborator no longer meets the project requirements");
  if (existing.some((intro) => intro.status === "accepted" || intro.status === "pending" && !expired(intro))) fail(409, "introduction_exists", "An active introduction already exists");
  const permitted = new Set(requester.contact_disclosure_fields || []);
  const fields = enumList(body.disclosure_fields, [...DISCLOSURE_FIELDS, "private_project_summary"])
    .filter((field) => field === "private_project_summary" || permitted.has(field));
  const intro = await db.create("IntroductionRequest", {
    match_id: match.id, project_need_id: need.id, requester_user_id: user.id, recipient_user_id: recipient.user_id,
    request_message: requireValue(body.request_message, "request_message", 2000), status: "pending",
    requester_disclosure_consent: true, recipient_disclosure_consent: false, requester_disclosure_fields: fields,
    recipient_disclosure_fields: [], approved_disclosure_fields: [],
    requester_snapshot: safeCard(requester, requesterClaims), recipient_snapshot: safeCard(recipient, recipientClaims),
    requested_at: nowIso(), expires_at: new Date(Date.now() + 21 * 86400000).toISOString()
  });
  await db.update("MatchRecord", match.id, { status: "introduction_requested" });
  await db.audit("introduction_requested", "IntroductionRequest", intro);
  return { introduction: { id: intro.id, status: intro.status, request_message: intro.request_message, requester_disclosure_fields: fields, requested_at: intro.requested_at, recipient: intro.recipient_snapshot, project_need: { id: need.id, title: need.title } }, contact_information_disclosed: false };
}

async function respondIntroduction(db, user, body) {
  const intro = await db.get("IntroductionRequest", requireValue(body.introduction_id, "introduction_id"));
  if (!intro || intro.owner_id !== intro.requester_user_id || ![intro.requester_user_id, intro.recipient_user_id].includes(user.id)) fail(404, "introduction_not_found", "Introduction not found or access denied");
  const action = text(body.action, 40);
  if (!["accept", "decline", "withdraw"].includes(action)) fail(400, "invalid_exchange_action", "Choose accept, decline, or withdraw");
  if (user.id !== (action === "withdraw" ? intro.requester_user_id : intro.recipient_user_id)) fail(403, "consent_required", "Only the designated participant can give or withdraw this consent");
  if (intro.status !== "pending" || expired(intro)) fail(409, "introduction_resolved", "This introduction is resolved or expired");
  if (action !== "accept") {
    const updated = await db.update("IntroductionRequest", intro.id, {
      status: action === "withdraw" ? "withdrawn" : "declined", requester_disclosure_consent: action !== "withdraw" && intro.requester_disclosure_consent,
      recipient_disclosure_consent: false, recipient_disclosure_fields: [], approved_disclosure_fields: [], responded_at: nowIso()
    });
    await db.update("MatchRecord", intro.match_id, { status: action === "withdraw" ? "saved" : "dismissed" });
    await db.audit(`introduction_${updated.status}`, "IntroductionRequest", intro);
    return { introduction: { id: updated.id, status: updated.status }, room: null, contact_information_disclosed: false };
  }
  if (!intro.requester_disclosure_consent || await db.blocked(intro.requester_user_id, intro.recipient_user_id)) fail(403, "exchange_blocked", "This introduction can no longer be accepted");
  const [requester, recipient, need] = await Promise.all([db.profile(intro.requester_user_id), db.profile(intro.recipient_user_id), db.get("ProjectNeed", intro.project_need_id)]);
  if (!availableProfile(requester) || !availableProfile(recipient) || !need || need.owner_id !== intro.requester_user_id || need.owner_user_id !== intro.requester_user_id || need.status !== "active" || need.visibility === "private") fail(409, "collaboration_unavailable", "A participant or project need is no longer available");
  const claims = await db.claims(recipient.user_id);
  if (!evaluateCandidate(need, recipient, claims).eligible) fail(409, "match_not_eligible", "This collaborator no longer meets the project requirements");
  const permitted = new Set(recipient.contact_disclosure_fields || []);
  const fields = enumList(body.disclosure_fields, DISCLOSURE_FIELDS).filter((field) => permitted.has(field));
  const requesterAllowed = new Set(requester.contact_disclosure_fields || []);
  const requesterFields = enumList(intro.requester_disclosure_fields, [...DISCLOSURE_FIELDS, "private_project_summary"])
    .filter((field) => field === "private_project_summary" || requesterAllowed.has(field));
  await db.update("IntroductionRequest", intro.id, {
    status: "accepted", requester_disclosure_fields: requesterFields, recipient_disclosure_consent: true,
    recipient_disclosure_fields: fields, approved_disclosure_fields: [...new Set([...requesterFields, ...fields])], responded_at: nowIso()
  });
  const room = await db.create("CollaborationRoom", {
    introduction_request_id: intro.id, project_id: "", project_need_id: intro.project_need_id,
    member_a_user_id: intro.requester_user_id, member_b_user_id: intro.recipient_user_id,
    member_aliases: { [intro.requester_user_id]: requester.public_alias, [intro.recipient_user_id]: recipient.public_alias },
    status: "active", created_at: nowIso(), last_message_at: nowIso()
  }, intro.requester_user_id);
  await db.update("MatchRecord", intro.match_id, { status: "connected" });
  await db.audit("introduction_accepted", "IntroductionRequest", intro, { room_id: room.id });
  return { introduction: { id: intro.id, status: "accepted" }, room: { id: room.id, status: room.status, project_need_id: room.project_need_id }, disclosure: { requester_fields: requesterFields, recipient_fields: fields, contact_details_available_only_inside_room: true } };
}

async function roomContext(db, user, body) {
  const room = await db.get("CollaborationRoom", requireValue(body.room_id, "room_id"));
  if (!isMember(room, user) || room.owner_id !== room.member_a_user_id) fail(404, "room_not_found", "Collaboration room not found or access denied");
  const intro = await db.get("IntroductionRequest", room.introduction_request_id);
  if (!intro || intro.owner_id !== intro.requester_user_id || intro.status !== "accepted" || !intro.requester_disclosure_consent || !intro.recipient_disclosure_consent ||
      intro.project_need_id !== room.project_need_id ||
      intro.requester_user_id !== room.member_a_user_id || intro.recipient_user_id !== room.member_b_user_id) fail(409, "consent_required", "This room has no mutually accepted introduction");
  const otherId = room.member_a_user_id === user.id ? room.member_b_user_id : room.member_a_user_id;
  const [ownProfile, otherProfile, blocked] = await Promise.all([db.profile(user.id), db.profile(otherId), db.blocked(user.id, otherId)]);
  const active = room.status === "active" && !blocked && ownProfile?.status !== "suspended" && otherProfile?.status !== "suspended";
  return { room, intro, otherId, ownProfile, otherProfile, active };
}

async function getRoom(db, repository, user, body) {
  const { room, intro, otherId, ownProfile, otherProfile, active } = await roomContext(db, user, body);
  const [need, messages, otherUser] = await Promise.all([
    db.get("ProjectNeed", room.project_need_id), db.all("RoomMessage", { room_id: room.id }, 500, "created_at"), repository.getUser(otherId)
  ]);
  if (!need || need.owner_id !== intro.requester_user_id || need.owner_user_id !== intro.requester_user_id) fail(409, "room_need_invalid", "The room project need is no longer available");
  const otherIsRequester = intro.requester_user_id === otherId;
  const allowed = new Set(otherProfile?.contact_disclosure_fields || []);
  const fields = active ? enumList(otherIsRequester ? intro.requester_disclosure_fields : intro.recipient_disclosure_fields, DISCLOSURE_FIELDS).filter((field) => allowed.has(field)) : [];
  return {
    room: { id: room.id, status: active ? "active" : "suspended", project_id: "", project_need_id: room.project_need_id, created_at: room.created_at, last_message_at: room.last_message_at,
      current_user_alias: text(ownProfile?.public_alias, 80, "You"), other_user_id: otherId, other_alias: text(otherProfile?.public_alias, 80, "Collaborator") },
    project_need: need ? { id: need.id, title: text(need.title, 160), public_summary: text(need.public_summary, 2000), private_summary: active && otherIsRequester && intro.requester_disclosure_fields.includes("private_project_summary") ? text(need.private_summary, 5000) : "", required_capabilities: list(need.required_capabilities), industry: text(need.industry, 100) } : null,
    other_contact: disclosedContact(otherProfile, otherUser, fields), messages: messages.map((message) => safeMessage(message, user)),
    privacy: { contact_fields_disclosed_by_other_member: fields, disclosure_is_mutual_consent_based: true }
  };
}

async function sendMessage(db, user, body) {
  const { room, otherId, ownProfile, active } = await roomContext(db, user, body);
  if (!active) fail(403, "exchange_blocked", "Messaging is unavailable in this room");
  if (Array.isArray(body.attachment_ids) && body.attachment_ids.length) fail(409, "room_attachments_unavailable", "File sharing in Exchange rooms requires a separate recipient access grant and is not available yet");
  const message = await db.create("RoomMessage", {
    room_id: room.id, sender_user_id: user.id, recipient_user_id: otherId, sender_alias: text(ownProfile?.public_alias, 80, "Member"),
    message: requireValue(body.message, "message", 5000), attachment_ids: [], created_at: nowIso(), status: "sent"
  });
  await db.update("CollaborationRoom", room.id, { last_message_at: message.created_at });
  await db.audit("message_sent", "RoomMessage", message, { room_id: room.id });
  return { message: safeMessage(message, user) };
}

async function blockUser(db, user, body) {
  const target = requireValue(body.target_user_id, "target_user_id");
  if (target === user.id) fail(400, "invalid_exchange_input", "You cannot block your own account");
  const action = text(body.action, 20, "block");
  if (!["block", "unblock"].includes(action)) fail(400, "invalid_exchange_action", "Choose block or unblock");
  const existing = (await db.all("ExchangeBlock", { blocker_user_id: user.id, blocked_user_id: target }, 1))[0];
  if (action === "unblock") {
    if (!existing) return { status: "not_blocked" };
    const saved = await db.update("ExchangeBlock", existing.id, { status: "removed", removed_at: nowIso() });
    await db.audit("user_unblocked", "ExchangeBlock", saved);
    return { block: { id: saved.id, blocked_user_id: target, status: saved.status } };
  }
  const input = { blocker_user_id: user.id, blocked_user_id: target, reason: text(body.reason, 500), status: "active", created_at: existing?.created_at || nowIso(), removed_at: "" };
  const saved = existing ? await db.update("ExchangeBlock", existing.id, input) : await db.create("ExchangeBlock", input);
  const [outgoing, incoming, roomsA, roomsB] = await Promise.all([
    db.all("IntroductionRequest", { requester_user_id: user.id, recipient_user_id: target }),
    db.all("IntroductionRequest", { requester_user_id: target, recipient_user_id: user.id }),
    db.all("CollaborationRoom", { member_a_user_id: user.id, member_b_user_id: target }),
    db.all("CollaborationRoom", { member_a_user_id: target, member_b_user_id: user.id })
  ]);
  let closed = 0;
  for (const intro of [...outgoing, ...incoming]) {
    if (intro.status === "pending") {
      await db.update("IntroductionRequest", intro.id, { status: "blocked", requester_disclosure_consent: false, recipient_disclosure_consent: false, recipient_disclosure_fields: [], approved_disclosure_fields: [], responded_at: nowIso() });
      closed += 1;
    }
  }
  const activeRooms = [...roomsA, ...roomsB].filter((room) => room.status === "active");
  for (const room of activeRooms) await db.update("CollaborationRoom", room.id, { status: "suspended" });
  await db.audit("user_blocked", "ExchangeBlock", saved, { pending_introductions_closed: closed, rooms_suspended: activeRooms.length });
  return { block: { id: saved.id, blocked_user_id: target, status: saved.status, created_at: saved.created_at }, pending_introductions_closed: closed, rooms_suspended: activeRooms.length };
}

async function saveClaim(db, user, body) {
  const id = text(body.claim_id, 200);
  const existing = id ? await db.get("CredentialClaim", id) : null;
  if (id && !isOwner(existing, user, "user_id")) fail(404, "claim_not_found", "Credential claim not found or access denied");
  const reference = text(body.reference_url ?? existing?.reference_url, 500);
  if (reference) {
    try { const url = new URL(reference); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { fail(400, "invalid_exchange_input", "Reference URL must be an HTTP(S) URL without credentials"); }
  }
  const expiresAt = text(body.expires_at ?? existing?.expires_at, 100);
  if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime())) fail(400, "invalid_exchange_input", "Credential expiry must be a valid date");
  const record = { user_id: user.id, user_email: user.email,
    credential_type: requireValue(body.credential_type ?? existing?.credential_type, "credential_type", 160),
    issuing_authority: requireValue(body.issuing_authority ?? existing?.issuing_authority, "issuing_authority", 200),
    claim_summary: requireValue(body.claim_summary ?? existing?.claim_summary, "claim_summary", 2000), jurisdiction: text(body.jurisdiction ?? existing?.jurisdiction, 120),
    reference_url: reference, verification_status: "pending", verification_method: "manual_review", reviewed_by: "", verified_at: "", expires_at: expiresAt, submitted_at: existing?.submitted_at || nowIso()
  };
  const claim = existing ? await db.update("CredentialClaim", existing.id, record) : await db.create("CredentialClaim", record);
  await refreshVerification(db, user.id);
  await db.audit("credential_submitted", "CredentialClaim", claim);
  return { claim, verification_notice: "Self-reported until an administrator reviews evidence from the issuing authority." };
}

async function refreshVerification(db, userId) {
  const [profile, claims] = await Promise.all([db.profile(userId), db.claims(userId)]);
  if (!profile || ["identity_verified", "organization_verified"].includes(profile.verification_level)) return;
  await db.update("CollaborationProfile", profile.id, { verification_level: claims.some((claim) => claim.verification_status === "verified") ? "credential_verified" : "unverified" });
}

async function reportUser(db, user, body) {
  const target = requireValue(body.reported_user_id, "reported_user_id");
  if (target === user.id) fail(400, "invalid_exchange_input", "You cannot report your own account");
  const description = requireValue(body.description, "description", 5000);
  if (description.length < 10) fail(400, "invalid_exchange_input", "Describe the concern in at least 10 characters");
  const roomId = text(body.room_id, 200);
  if (roomId) {
    const room = await db.get("CollaborationRoom", roomId);
    if (!isMember(room, user) || ![room.member_a_user_id, room.member_b_user_id].includes(target)) fail(404, "room_not_found", "Room not found or access denied");
  }
  const reasons = ["spam", "harassment", "misrepresentation", "credential_concern", "conflict_of_interest", "privacy_concern", "fraud_concern", "other"];
  const report = await db.create("ExchangeSafetyReport", { reporter_user_id: user.id, reporter_email: user.email, reported_user_id: target, room_id: roomId, reason: reasons.includes(body.reason) ? body.reason : "other", description, status: "submitted", admin_notes: "", created_at: nowIso() });
  await db.audit("safety_reported", "ExchangeSafetyReport", report);
  return { report: { id: report.id, reason: report.reason, status: report.status, created_at: report.created_at }, next_action: "Queued for administrator review. Block the account to stop introductions and suspend your shared rooms." };
}

async function adminDashboard(db, user) {
  if (user.role !== "admin") fail(403, "administrator_required", "Administrator access required");
  const [profiles, needs, claims, reports, blocks, intros, rooms, audits] = await Promise.all([
    db.all("CollaborationProfile"), db.all("ProjectNeed"), db.all("CredentialClaim"), db.all("ExchangeSafetyReport"),
    db.all("ExchangeBlock", { status: "active" }), db.all("IntroductionRequest"), db.all("CollaborationRoom"), db.all("ExchangeAuditEvent", {}, 100, "-created_at")
  ]);
  return { generated_at: nowIso(), counts: { profiles_total: profiles.length, profiles_active: profiles.filter((p) => p.status === "active").length, needs_active: needs.filter((p) => p.status === "active").length, credentials_pending: claims.filter((c) => c.verification_status === "pending").length, safety_reports_open: reports.filter((r) => ["submitted", "reviewing"].includes(r.status)).length, active_blocks: blocks.length, introductions_pending: intros.filter((i) => i.status === "pending" && !expired(i)).length, rooms_active: rooms.filter((r) => r.status === "active").length },
    pending_credentials: claims.filter((c) => c.verification_status === "pending").map((claim) => ({ ...claim, profile: safeCard(profiles.find((p) => p.user_id === claim.user_id), []) })),
    open_reports: reports.filter((r) => ["submitted", "reviewing"].includes(r.status)).map((report) => ({ ...report, reported_profile: safeCard(profiles.find((p) => p.user_id === report.reported_user_id), []) })),
    recent_audit: audits, privacy_boundary: "Administrator-only moderation metadata; private room messages and contact details are not included.", record_limit: 500 };
}

async function adminReview(db, user, body) {
  if (user.role !== "admin") fail(403, "administrator_required", "Administrator access required");
  let result;
  let entity;
  if (body.action === "review_credential") {
    entity = "CredentialClaim";
    const claim = await db.get(entity, requireValue(body.claim_id, "claim_id"));
    if (!claim) fail(404, "claim_not_found", "Credential claim not found");
    if (!["verified", "rejected"].includes(body.decision)) fail(400, "invalid_exchange_action", "Choose verified or rejected");
    if (body.decision === "verified" && expired(claim)) fail(409, "credential_expired", "An expired credential cannot be verified");
    const methods = ["document_review", "official_registry", "organization_confirmation", "manual_review"];
    if (!methods.includes(body.verification_method)) fail(400, "verification_method_required", "Record the verification method");
    result = await db.update(entity, claim.id, { verification_status: body.decision, verification_method: body.verification_method, reviewed_by: user.email, verified_at: body.decision === "verified" ? nowIso() : "" });
    await refreshVerification(db, claim.user_id);
  } else if (body.action === "resolve_report") {
    entity = "ExchangeSafetyReport";
    const report = await db.get(entity, requireValue(body.report_id, "report_id"));
    if (!report) fail(404, "report_not_found", "Safety report not found");
    if (!["reviewing", "action_taken", "dismissed", "resolved"].includes(body.decision)) fail(400, "invalid_exchange_action", "Choose a report review decision");
    result = await db.update(entity, report.id, { status: body.decision, admin_notes: text(body.admin_notes, 5000), resolved_at: body.decision === "reviewing" ? "" : nowIso() });
    if (body.suspend_profile === true) {
      const profile = await db.profile(report.reported_user_id);
      if (profile) await db.update("CollaborationProfile", profile.id, { status: "suspended", visibility: "private", updated_at: nowIso() });
    }
  } else if (body.action === "set_profile_status") {
    entity = "CollaborationProfile";
    const profile = await db.get(entity, requireValue(body.profile_id, "profile_id"));
    if (!profile) fail(404, "profile_not_found", "Collaboration profile not found");
    if (!["active", "paused", "suspended"].includes(body.status)) fail(400, "invalid_exchange_action", "Choose active, paused, or suspended");
    result = await db.update(entity, profile.id, { status: body.status, visibility: body.status === "suspended" ? "private" : profile.visibility, updated_at: nowIso() });
  } else fail(400, "invalid_exchange_action", "Unsupported administrator action");
  await db.audit("admin_" + body.action, entity, result, { decision: body.decision || body.status });
  return { result };
}

async function analyzeNeeds(repository, user, body) {
  const projectId = text(body.project_id, 200);
  const project = projectId ? await ownedProject(repository, user, projectId) : null;
  const description = text(body.description, 5000) || text(project?.description, 5000);
  const notes = text(body.founder_notes, 3000);
  if (!description && !notes) fail(400, "invalid_exchange_input", "Add a project description or founder notes before analysis");
  const source = `${description} ${notes}`.toLowerCase();
  const candidates = [
    [/\b(app|website|software|platform|api)\b/, "Software architecture and implementation", "Review the application's functionality, deployment, authentication, and maintenance requirements."],
    [/\b(payment|checkout|subscription|stripe|commerce|marketplace)\b/, "Payment integration and accounting", "Review payment ownership, refunds, reconciliation, and subscription behavior."],
    [/\b(ai|model|generation|audio|video)\b/, "AI provider integration and reliability", "Review provider permissions, generation quality, recovery, and usage costs."],
    [/\b(medical|health|patient|financial|insurance|regulated)\b/, "Qualified domain and compliance review", "Identify the applicable jurisdiction and independently verify required professional credentials."],
    [/\b(shipping|freight|delivery|inventory)\b/, "Operations and logistics", "Review fulfillment, inventory accuracy, exception handling, and service ownership."]
  ];
  const missing = candidates.filter(([pattern]) => pattern.test(source)).map(([, capability, reason]) => ({ capability, priority: "medium", relationship: "open_to_discussion", reason: `${reason} The supplied description does not establish whether your team already has this capability.`, credential_or_jurisdiction: "" }));
  return {
    analysis: { project_stage: "", industry: text(body.industry || project?.category, 100, "Other"), existing_capabilities: [], missing_capabilities: missing,
      suggested_public_summary: "", suggested_private_summary: [description, notes].filter(Boolean).join("\n\n").slice(0, 5000), suggested_compensation: ["open_to_discussion"],
      questions: ["Which capabilities are already covered by you or your team?", "What stage has this project actually reached?", "Which jurisdiction, credentials, availability, and working terms are mandatory?", "Which details do you explicitly want to put into a match-visible public summary?"] },
    project: project ? { id: project.id, title: text(project.title, 100) } : null, advisory_only: true, credential_verification_performed: false, regulatory_classification_performed: false,
    analysis_method: "local_requirements_checklist", limitation: "Keyword-based review prompts; this is not an AI assessment or evidence that your team lacks these capabilities. Project stage and required expertise must be confirmed.", may_use_integration_credits: false
  };
}

async function dispatch({ name, body, user, repository }) {
  const db = records(repository, user);
  if (name === "get-exchange-dashboard") return dashboard(db, repository, user);
  if (name === "save-exchange-profile") {
    const existing = await db.profile(user.id);
    if (existing?.status === "suspended") fail(403, "profile_suspended", "Administrator review is required before changing a suspended profile");
    let input;
    try { input = sanitizeProfileInput(body, user, existing); }
    catch (error) { fail(400, "invalid_exchange_input", error.message); }
    const profile = existing ? await db.update("CollaborationProfile", existing.id, input) : await db.create("CollaborationProfile", input);
    await db.audit("profile_saved", "CollaborationProfile", profile);
    return { profile, disclosure_rule: "Contact fields remain private until each member explicitly accepts an introduction." };
  }
  if (name === "save-project-need") {
    const id = text(body.need_id, 200);
    const existing = id ? await ownNeed(db, user, id) : null;
    let input;
    try { input = sanitizeNeedInput(body, user, existing); }
    catch (error) { fail(400, "invalid_exchange_input", error.message); }
    if (input.project_id) await ownedProject(repository, user, input.project_id);
    const need = existing ? await db.update("ProjectNeed", existing.id, input) : await db.create("ProjectNeed", input);
    await db.audit("need_saved", "ProjectNeed", need);
    return { need, matching_ready: need.status === "active" && need.visibility !== "private" && need.required_capabilities.length > 0 };
  }
  if (name === "analyze-project-needs") return analyzeNeeds(repository, user, body);
  if (name === "find-collaboration-matches") return findMatches(db, user, body);
  if (name === "request-introduction") return requestIntroduction(db, user, body);
  if (name === "respond-to-introduction") return respondIntroduction(db, user, body);
  if (name === "get-collaboration-room") return getRoom(db, repository, user, body);
  if (name === "send-collaboration-message") return sendMessage(db, user, body);
  if (name === "save-credential-claim") return saveClaim(db, user, body);
  if (name === "block-exchange-user") return blockUser(db, user, body);
  if (name === "report-exchange-user") return reportUser(db, user, body);
  if (name === "get-exchange-admin") return adminDashboard(db, user);
  if (name === "admin-review-exchange") return adminReview(db, user, body);
}

export async function handleExchangeFunction({ name, body = {}, user, repository }) {
  if (!EXCHANGE_FUNCTIONS.has(name)) return null;
  if (!user?.id) fail(401, "authentication_required", "Sign in to use Exchange");
  if (!repository.withRecordTransaction || !repository.listRecordsExact) fail(503, "exchange_transactions_unavailable", "Exchange requires transactional record storage with exact queries");
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const payload = await repository.withRecordTransaction((transaction) => dispatch({ name, body: input, user, repository: transaction }));
  return { status: 200, payload: { data: { ok: true, exchange_version: EXCHANGE_VERSION, charged: false, ...payload } } };
}
