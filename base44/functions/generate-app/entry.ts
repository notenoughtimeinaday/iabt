import { createClientFromRequest } from "npm:@base44/sdk";

const COMPONENT_TYPES = ["Text", "Input", "Button", "ScannerInput"];
const PLAN_DEFAULTS = {
  free: {
    ai_hourly_limit: 5,
    ai_monthly_limit: 10,
    project_limit: 1,
    static_zip_export_enabled: false,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  builder: {
    ai_hourly_limit: 30,
    ai_monthly_limit: 100,
    project_limit: 5,
    static_zip_export_enabled: true,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  pro: {
    ai_hourly_limit: 100,
    ai_monthly_limit: 500,
    project_limit: 25,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  agency: {
    ai_hourly_limit: 200,
    ai_monthly_limit: 2000,
    project_limit: 0,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: true,
    team_seat_limit: 5,
  },
};

const componentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: COMPONENT_TYPES },
    props: {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string" },
        placeholder: { type: "string" },
        label: { type: "string" },
        to: { type: "string" },
      },
    },
  },
  required: ["type", "props"],
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    app: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name", "description"],
    },
    pages: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          route: { type: "string" },
          layout: { type: "string", enum: ["column"] },
          components: { type: "array", maxItems: 40, items: componentSchema },
        },
        required: ["name", "route", "layout", "components"],
      },
    },
  },
  required: ["app", "pages"],
};

function validateGenerated(result: unknown) {
  if (!result || typeof result !== "object") throw new Error("AI returned an invalid app definition.");
  const value = result as Record<string, unknown>;
  if (!value.app || typeof value.app !== "object") throw new Error("AI response is missing app metadata.");
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 8) {
    throw new Error("AI response must contain between 1 and 8 pages.");
  }

  const routes = new Set<string>();
  for (const rawPage of value.pages) {
    if (!rawPage || typeof rawPage !== "object") throw new Error("AI returned an invalid page.");
    const page = rawPage as Record<string, unknown>;
    if (typeof page.name !== "string" || !page.name.trim()) throw new Error("Every generated page needs a name.");
    if (typeof page.route !== "string" || !page.route.startsWith("/")) throw new Error("Every generated route must start with /.");
    if (routes.has(page.route)) throw new Error("AI returned duplicate page routes.");
    routes.add(page.route);
    if (!Array.isArray(page.components) || page.components.length > 40) throw new Error("A generated page has too many components.");
    for (const rawComponent of page.components) {
      if (!rawComponent || typeof rawComponent !== "object") throw new Error("AI returned an invalid component.");
      const component = rawComponent as Record<string, unknown>;
      if (!COMPONENT_TYPES.includes(String(component.type))) throw new Error("AI returned an unsupported component.");
      if (!component.props || typeof component.props !== "object") throw new Error("AI returned invalid component properties.");
    }
  }
  return value;
}

function planDefaults(plan: string) {
  return PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS] || PLAN_DEFAULTS.free;
}

async function getOrCreateEntitlement(base44: any, user: any) {
  const service = base44.asServiceRole;
  const records = await service.entities.AccountEntitlement.filter({ user_id: user.id }, "-updated_date", 1);
  const current = records?.[0];
  if (current) {
    const isActive = ["active", "trialing"].includes(String(current.status));
    const activePlan = isActive ? String(current.plan || "free") : "free";
    if (isActive) {
      const defaults = planDefaults(activePlan);
      const foundingAdmin = user.role === "admin" && current.billing_provider === "none";
      return foundingAdmin
        ? { ...defaults, ...current, plan: activePlan }
        : { ...current, ...defaults, bonus_ai_credits: Number(current.bonus_ai_credits || 0), plan: activePlan };
    }
    return { ...current, ...planDefaults("free"), bonus_ai_credits: Number(current.bonus_ai_credits || 0), plan: "free" };
  }

  const plan = user.role === "admin" ? "pro" : "free";
  const defaults = planDefaults(plan);
  return service.entities.AccountEntitlement.create({
    user_id: user.id,
    user_email: user.email,
    plan,
    status: "active",
    billing_provider: "none",
    ...defaults,
    ai_hourly_limit: user.role === "admin" ? 200 : defaults.ai_hourly_limit,
    project_limit: user.role === "admin" ? 0 : defaults.project_limit,
    bonus_ai_credits: 0,
    notes: user.role === "admin" ? "Founding administrator entitlement" : "Default free entitlement",
  });
}

async function incrementUsageBucket(base44: any, user: any, key: string, current: any, now: Date) {
  const service = base44.asServiceRole;
  const nextUsed = Number(current?.request_count || 0) + 1;
  if (current) {
    await service.entities.AiUsage.update(current.id, {
      request_count: nextUsed,
      last_request_at: now.toISOString(),
    });
  } else {
    await service.entities.AiUsage.create({
      user_id: user.id,
      user_email: user.email,
      usage_kind: "app_generation",
      window_key: key,
      request_count: nextUsed,
      last_request_at: now.toISOString(),
    });
  }
  return nextUsed;
}

async function enforceRateLimit(base44: any, user: any, entitlement: any) {
  const now = new Date();
  const defaults = planDefaults(entitlement.plan);
  const hourlyKey = "hour:" + now.toISOString().slice(0, 13);
  const monthlyKey = "month:" + now.toISOString().slice(0, 7);
  const hourlyLimit = Math.max(1, Number(entitlement.ai_hourly_limit || defaults.ai_hourly_limit));
  const monthlyLimit = Math.max(1, Number(entitlement.ai_monthly_limit || defaults.ai_monthly_limit));
  const bonusCredits = Math.max(0, Number(entitlement.bonus_ai_credits || 0));

  const service = base44.asServiceRole;
  const [hourlyRecords, monthlyRecords] = await Promise.all([
    service.entities.AiUsage.filter({ user_id: user.id, window_key: hourlyKey }, "-updated_date", 1),
    service.entities.AiUsage.filter({ user_id: user.id, window_key: monthlyKey }, "-updated_date", 1),
  ]);
  const hourly = hourlyRecords?.[0];
  const monthly = monthlyRecords?.[0];
  const hourlyUsed = Number(hourly?.request_count || 0);
  const monthlyUsed = Number(monthly?.request_count || 0);

  if (hourlyUsed >= hourlyLimit) {
    throw new Response(
      JSON.stringify({
        error: "Hourly AI safety limit reached. Try again after the hour changes.",
        plan: entitlement.plan,
        limit: hourlyLimit,
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const useBonusCredit = monthlyUsed >= monthlyLimit;
  if (useBonusCredit && bonusCredits < 1) {
    throw new Response(
      JSON.stringify({
        error: "Monthly AI generation allowance reached. Upgrade your plan or add an AI credit pack.",
        plan: entitlement.plan,
        limit: monthlyLimit,
        bonus_remaining: bonusCredits,
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  if (useBonusCredit) {
    await base44.asServiceRole.entities.AccountEntitlement.update(entitlement.id, {
      bonus_ai_credits: bonusCredits - 1,
    });
  }

  const [nextHourlyUsed, nextMonthlyUsed] = await Promise.all([
    incrementUsageBucket(base44, user, hourlyKey, hourly, now),
    incrementUsageBucket(base44, user, monthlyKey, monthly, now),
  ]);

  return {
    limit: hourlyLimit,
    used: nextHourlyUsed,
    remaining: Math.max(0, hourlyLimit - nextHourlyUsed),
    monthly_limit: monthlyLimit,
    monthly_used: nextMonthlyUsed,
    monthly_remaining: Math.max(0, monthlyLimit - nextMonthlyUsed),
    bonus_remaining: useBonusCredit ? bonusCredits - 1 : bonusCredits,
  };
}

async function generateWithOpenAI(apiKey: string, prompt: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You design concise, usable SaaS application flows for IABT. Return only data matching the supplied JSON schema. " +
            "Use only Text(value), Input(placeholder), Button(label,to optional), and ScannerInput(label). " +
            "Buttons that navigate must use the exact route of a generated page. Keep the result under eight pages.",
        },
        { role: "user", content: prompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "iabt_app_definition",
          strict: false,
          schema: responseSchema,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || "OpenAI generation failed.";
    throw new Error(message);
  }
  const outputText = payload?.output_text;
  if (!outputText) throw new Error("OpenAI returned an empty response.");
  return JSON.parse(outputText);
}

function parseGeneratedText(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned text without a JSON app definition.");
  return JSON.parse(candidate.slice(start, end + 1));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    const body = await req.json();
    const prompt = String(body?.prompt || "").trim();
    const context = body?.context && typeof body.context === "object" ? body.context : null;

    if (!prompt) return Response.json({ error: "Describe the app you want to generate." }, { status: 400 });
    if (prompt.length > 6000) return Response.json({ error: "Prompt is too long." }, { status: 400 });

    const entitlement = await getOrCreateEntitlement(base44, user);
    const usage = await enforceRateLimit(base44, user, entitlement);

    const existingContext = context
      ? "\n\nExisting app context (preserve or extend when useful):\n" + JSON.stringify(context).slice(0, 12000)
      : "";
    const fullPrompt = prompt + existingContext;
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    let generated;
    let provider;
    let openAIError = "";

    if (apiKey) {
      try {
        generated = await generateWithOpenAI(apiKey, fullPrompt);
        provider = "openai";
      } catch (error) {
        openAIError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!generated) {
      try {
        generated = parseGeneratedText(await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt:
            "Design an IABT SaaS application from this request:\n\n" +
            fullPrompt +
            "\n\nReturn exactly one JSON object and no markdown. Use this shape: " +
            "{\"app\":{\"name\":\"App name\",\"description\":\"Purpose\"},\"pages\":[{\"name\":\"Page name\",\"route\":\"/route\",\"layout\":\"column\",\"components\":[{\"type\":\"Text\",\"props\":{\"value\":\"Text\"}}]}]}. " +
            "Use only Text(value), Input(placeholder), Button(label and optional to), and ScannerInput(label) components. " +
            "Button routes must exactly match generated page routes. Create one to eight concise pages.",
        }));
        provider = apiKey ? "base44-managed-ai-fallback" : "base44-managed-ai";
      } catch (error) {
        const managedError = error instanceof Error ? error.message : String(error);
        if (openAIError) {
          throw new Error(
            "OpenAI generation failed (" + openAIError + "); Base44 managed AI fallback also failed (" + managedError + ").",
          );
        }
        throw error;
      }
    }

    const result = validateGenerated(generated);
    return Response.json({
      ok: true,
      provider,
      generated_at: new Date().toISOString(),
      entitlement: {
        plan: entitlement.plan,
        status: entitlement.status,
        project_limit: entitlement.project_limit,
        static_zip_export_enabled: entitlement.static_zip_export_enabled,
        react_export_enabled: entitlement.react_export_enabled,
        commercial_use_enabled: entitlement.commercial_use_enabled,
        white_label_exports_enabled: entitlement.white_label_exports_enabled,
        team_seat_limit: entitlement.team_seat_limit,
        ai_monthly_limit: entitlement.ai_monthly_limit,
        bonus_ai_credits: entitlement.bonus_ai_credits,
      },
      usage,
      app: result.app,
      pages: result.pages,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
