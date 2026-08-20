import { createClientFromRequest } from "npm:@base44/sdk";

const COMPONENT_TYPES = ["Text", "Input", "Button", "ScannerInput"];
const MAX_REQUESTS_PER_HOUR = 20;

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

async function enforceRateLimit(base44: any) {
  const now = new Date();
  const windowKey = now.toISOString().slice(0, 13);
  const records = await base44.entities.AiUsage.filter({ window_key: windowKey }, "-updated_date", 1);
  const current = records?.[0];

  if (current && Number(current.request_count || 0) >= MAX_REQUESTS_PER_HOUR) {
    throw new Response(
      JSON.stringify({ error: "Hourly AI generation limit reached. Try again after the hour changes." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  if (current) {
    await base44.entities.AiUsage.update(current.id, {
      request_count: Number(current.request_count || 0) + 1,
      last_request_at: now.toISOString(),
    });
  } else {
    await base44.entities.AiUsage.create({
      window_key: windowKey,
      request_count: 1,
      last_request_at: now.toISOString(),
    });
  }
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

    await enforceRateLimit(base44);

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
        generated = await base44.integrations.Core.InvokeLLM({
          prompt:
            "Design an IABT SaaS application from this request:\n\n" +
            fullPrompt +
            "\n\nUse only Text, Input, Button, and ScannerInput components. Button routes must match generated page routes.",
          response_json_schema: responseSchema,
        });
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
      app: result.app,
      pages: result.pages,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
