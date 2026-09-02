import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import { EXCHANGE_VERSION, auditExchange, evaluateCandidate, profileCard, text } from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const needId = text(body?.project_need_id, 200);
    if (!needId) return Response.json({ error: "project_need_id is required." }, { status: 400 });

    const service = base44.asServiceRole;
    const need = await service.entities.ProjectNeed.get(needId).catch(() => null);
    if (!need || (String(need.owner_user_id || "") !== String(user.id) && user.role !== "admin")) {
      return Response.json({ error: "Project need not found or access denied." }, { status: 404 });
    }
    if (need.status !== "active") return Response.json({ error: "Activate this project need before matching." }, { status: 400 });

    const [profiles, claims, ownerBlocks, reverseBlocks, previous] = await Promise.all([
      service.entities.CollaborationProfile.filter({ status: "active" }, "-updated_at", 500).catch(() => []),
      service.entities.CredentialClaim.list("-submitted_at", 2000).catch(() => []),
      service.entities.ExchangeBlock.filter({ blocker_user_id: user.id, status: "active" }, "-created_at", 500).catch(() => []),
      service.entities.ExchangeBlock.filter({ blocked_user_id: user.id, status: "active" }, "-created_at", 500).catch(() => []),
      service.entities.MatchRecord.filter({ project_need_id: need.id }, "-generated_at", 500).catch(() => []),
    ]);

    const excluded = new Set<string>([String(user.id)]);
    for (const row of ownerBlocks || []) excluded.add(String(row.blocked_user_id || ""));
    for (const row of reverseBlocks || []) excluded.add(String(row.blocker_user_id || ""));
    const claimsByUser = new Map<string, any[]>();
    for (const claim of claims || []) {
      const key = String(claim.user_id || "");
      if (!claimsByUser.has(key)) claimsByUser.set(key, []);
      claimsByUser.get(key)?.push(claim);
    }

    const ranked = (profiles || [])
      .filter((profile: any) => !excluded.has(String(profile.user_id || "")))
      .map((profile: any) => ({
        profile,
        claims: claimsByUser.get(String(profile.user_id || "")) || [],
        evaluation: evaluateCandidate(need, profile, claimsByUser.get(String(profile.user_id || "")) || []),
      }))
      .filter((item: any) => item.evaluation.eligible)
      .sort((a: any, b: any) => b.evaluation.total_score - a.evaluation.total_score)
      .slice(0, 25);

    const previousByUser = new Map((previous || []).map((row: any) => [String(row.candidate_user_id || ""), row]));
    const kept = new Set<string>();
    const matches: any[] = [];
    for (const item of ranked) {
      const existing: any = previousByUser.get(String(item.profile.user_id || ""));
      const payload = {
        project_need_id: need.id,
        owner_user_id: need.owner_user_id,
        candidate_profile_id: item.profile.id,
        candidate_user_id: item.profile.user_id,
        total_score: item.evaluation.total_score,
        score_breakdown: item.evaluation.score_breakdown,
        hard_filter_results: item.evaluation.hard_filter_results,
        ai_explanation: item.evaluation.explanation,
        status: existing && ["saved", "introduction_requested", "connected"].includes(existing.status) ? existing.status : "suggested",
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2592000000).toISOString(),
      };
      const saved = existing?.id
        ? await service.entities.MatchRecord.update(existing.id, payload)
        : await service.entities.MatchRecord.create(payload);
      kept.add(String(saved.candidate_user_id || ""));
      matches.push({
        id: saved.id,
        project_need_id: saved.project_need_id,
        candidate_user_id: String(saved.candidate_user_id || ""),
        total_score: saved.total_score,
        score_breakdown: saved.score_breakdown,
        hard_filter_results: saved.hard_filter_results,
        ai_explanation: saved.ai_explanation,
        status: saved.status,
        generated_at: saved.generated_at,
        candidate: profileCard(item.profile, item.claims),
      });
    }

    for (const row of previous || []) {
      if (!kept.has(String(row.candidate_user_id || "")) && ["suggested", "saved"].includes(row.status)) {
        await service.entities.MatchRecord.update(row.id, { status: "expired" }).catch(() => null);
      }
    }

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      event_type: "matches_generated",
      entity_type: "ProjectNeed",
      entity_id: need.id,
      summary: `Generated ${matches.length} eligible collaboration matches.`,
      metadata: { match_count: matches.length, algorithm: "deterministic_weighted_v1" },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      algorithm: {
        name: "deterministic_weighted_v1",
        weights: { capability_fit: 35, jurisdiction_credentials: 20, availability: 15, project_stage: 15, relationship_compensation: 10, reputation: 5 },
        random_selection: false,
      },
      project_need: { id: need.id, title: text(need.title, 160) },
      matches,
      match_count: matches.length,
      privacy: "Only match-safe fields are returned. Contact details remain hidden until mutual consent.",
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
