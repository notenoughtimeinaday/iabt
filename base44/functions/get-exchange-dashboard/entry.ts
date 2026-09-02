import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  profileCard,
  text,
} from "../../shared/exchange.ts";

function uniqueRows(rows: any[]) {
  const byId = new Map<string, any>();
  for (const row of rows || []) {
    if (row?.id) byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

function safeNeed(need: any, owner = false) {
  if (!need) return null;
  return {
    id: String(need.id || ""),
    project_id: String(need.project_id || ""),
    title: text(need.title, 160),
    public_summary: text(need.public_summary, 2000),
    ...(owner ? { private_summary: text(need.private_summary, 5000) } : {}),
    required_capabilities: Array.isArray(need.required_capabilities) ? need.required_capabilities : [],
    mandatory_credentials: Array.isArray(need.mandatory_credentials) ? need.mandatory_credentials : [],
    industry: text(need.industry, 100),
    jurisdictions: Array.isArray(need.jurisdictions) ? need.jurisdictions : [],
    project_stage: need.project_stage,
    relationship_requested: Array.isArray(need.relationship_requested) ? need.relationship_requested : [],
    compensation_model: Array.isArray(need.compensation_model) ? need.compensation_model : [],
    time_commitment: text(need.time_commitment, 200),
    visibility: need.visibility,
    status: need.status,
    created_at: need.created_at || need.created_date || null,
    updated_at: need.updated_at || need.updated_date || null,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const service = base44.asServiceRole;

    const [profiles, needs, ownerMatches, outgoing, incoming, roomsA, roomsB, credentials, reports, blocks, projects] = await Promise.all([
      service.entities.CollaborationProfile.filter({ user_id: user.id }, "-updated_at", 1).catch(() => []),
      service.entities.ProjectNeed.filter({ owner_user_id: user.id }, "-updated_at", 100).catch(() => []),
      service.entities.MatchRecord.filter({ owner_user_id: user.id }, "-generated_at", 250).catch(() => []),
      service.entities.IntroductionRequest.filter({ requester_user_id: user.id }, "-requested_at", 100).catch(() => []),
      service.entities.IntroductionRequest.filter({ recipient_user_id: user.id }, "-requested_at", 100).catch(() => []),
      service.entities.CollaborationRoom.filter({ member_a_user_id: user.id }, "-last_message_at", 100).catch(() => []),
      service.entities.CollaborationRoom.filter({ member_b_user_id: user.id }, "-last_message_at", 100).catch(() => []),
      service.entities.CredentialClaim.filter({ user_id: user.id }, "-submitted_at", 100).catch(() => []),
      service.entities.ExchangeSafetyReport.filter({ reporter_user_id: user.id }, "-created_at", 100).catch(() => []),
      service.entities.ExchangeBlock.filter({ blocker_user_id: user.id, status: "active" }, "-created_at", 100).catch(() => []),
      base44.entities.Project.list("-updated_date", 250).catch(() => []),
    ]);

    const allProfiles = await service.entities.CollaborationProfile.list("-updated_at", 500).catch(() => []);
    const allClaims = await service.entities.CredentialClaim.list("-submitted_at", 1000).catch(() => []);
    const allNeeds = await service.entities.ProjectNeed.list("-updated_at", 500).catch(() => []);
    const profileById = new Map((allProfiles || []).map((row: any) => [String(row.id), row]));
    const needById = new Map((allNeeds || []).map((row: any) => [String(row.id), row]));
    const claimsByUser = new Map<string, any[]>();
    for (const claim of allClaims || []) {
      const key = String(claim.user_id || "");
      if (!claimsByUser.has(key)) claimsByUser.set(key, []);
      claimsByUser.get(key)?.push(claim);
    }

    const matches = (ownerMatches || []).map((match: any) => {
      const profile = profileById.get(String(match.candidate_profile_id || ""));
      return {
        id: match.id,
        project_need_id: match.project_need_id,
        total_score: Number(match.total_score || 0),
        score_breakdown: match.score_breakdown || {},
        hard_filter_results: match.hard_filter_results || {},
        ai_explanation: text(match.ai_explanation, 2000),
        status: match.status,
        generated_at: match.generated_at || match.created_date || null,
        candidate: profile ? profileCard(profile, claimsByUser.get(String(profile.user_id || "")) || []) : null,
      };
    }).filter((match: any) => match.candidate);

    const introductions = uniqueRows([...(outgoing || []), ...(incoming || [])]).map((item: any) => ({
      id: item.id,
      match_id: item.match_id,
      project_need_id: item.project_need_id,
      direction: String(item.requester_user_id) === String(user.id) ? "outgoing" : "incoming",
      request_message: text(item.request_message, 2000),
      status: item.status,
      requester_disclosure_consent: item.requester_disclosure_consent === true,
      recipient_disclosure_consent: item.recipient_disclosure_consent === true,
      requester_disclosure_fields: Array.isArray(item.requester_disclosure_fields) ? item.requester_disclosure_fields : [],
      recipient_disclosure_fields: Array.isArray(item.recipient_disclosure_fields) ? item.recipient_disclosure_fields : [],
      requester_snapshot: item.requester_snapshot || {},
      recipient_snapshot: item.recipient_snapshot || {},
      need: safeNeed(needById.get(String(item.project_need_id || "")), false),
      requested_at: item.requested_at || item.created_date || null,
      responded_at: item.responded_at || null,
    }));

    const collaborationRooms = uniqueRows([...(roomsA || []), ...(roomsB || [])]).map((room: any) => {
      const otherId = String(room.member_a_user_id) === String(user.id)
        ? String(room.member_b_user_id || "")
        : String(room.member_a_user_id || "");
      const aliases = room.member_aliases || {};
      return {
        id: room.id,
        project_id: room.project_id || "",
        project_need_id: room.project_need_id,
        status: room.status,
        other_user_id: otherId,
        other_alias: aliases[otherId] || "Collaborator",
        need: safeNeed(needById.get(String(room.project_need_id || "")), false),
        created_at: room.created_at || room.created_date || null,
        last_message_at: room.last_message_at || room.created_at || null,
      };
    });

    const ownProfile = profiles?.[0] || null;
    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      beta: true,
      profile: ownProfile,
      needs: (needs || []).map((need: any) => safeNeed(need, true)),
      matches,
      introductions,
      rooms: collaborationRooms,
      credentials: credentials || [],
      safety_reports: reports || [],
      blocks: (blocks || []).map((block: any) => ({
        id: block.id,
        blocked_user_id: block.blocked_user_id,
        reason: text(block.reason, 500),
        created_at: block.created_at || null,
      })),
      projects: (projects || []).map((project: any) => ({
        id: project.id,
        title: text(project.title, 100),
        description: text(project.description, 500),
        category: project.category,
        status: project.status,
      })),
      counts: {
        active_needs: (needs || []).filter((need: any) => need.status === "active").length,
        suggested_matches: matches.filter((match: any) => ["suggested", "saved"].includes(match.status)).length,
        incoming_introductions: introductions.filter((item: any) => item.direction === "incoming" && item.status === "pending").length,
        active_rooms: collaborationRooms.filter((room: any) => room.status === "active").length,
      },
      privacy: {
        matching_is_opt_in: true,
        public_directory_enabled: false,
        identity_disclosed_before_consent: false,
        private_project_summary_disclosed_before_consent: false,
      },
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
