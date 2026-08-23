import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getOrCreateEntitlement,
  releaseIabtCredits,
  reserveIabtCredits,
} from "../../shared/usage.ts";

const COMPONENT_TYPES = ["Text", "Input", "Button", "ScannerInput"];
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
  let base44: any = null;
  let creditReservation: any = null;
  let completed = false;
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    base44 = createClientFromRequest(req);
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

    await getOrCreateEntitlement(base44, user);
    const credit = await reserveIabtCredits(base44, user, 1, {
      usageKind: "app_generation",
      paidMedia: false,
    });
    creditReservation = credit.reservation;
    const entitlement = credit.entitlement;
    const usage = credit.usage;

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
    completed = true;
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
    if (creditReservation && base44 && !completed) {
      try {
        await releaseIabtCredits(base44, creditReservation);
      } catch (releaseError) {
        console.error("generate-app credit release failed:", releaseError);
      }
    }
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
