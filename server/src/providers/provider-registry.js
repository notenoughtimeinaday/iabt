export class ProviderCallError extends Error {
  constructor(code, message, { status = 409, retryable = false, providerRequestId = "" } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.providerRequestId = providerRequestId;
  }
}

const requireApproval = (context = {}, expectedCostCents = 0) => {
  const approval = context.approval || {};
  if (
    approval.approved !== true ||
    !String(approval.approval_id || "").trim() ||
    !String(context.idempotencyKey || "").trim()
  ) {
    throw new ProviderCallError(
      "explicit_approval_required",
      "A server-owned approval and idempotency key are required before a provider call"
    );
  }
  const ceiling = Number(approval.max_cost_cents);
  if (!Number.isInteger(ceiling) || ceiling < Math.max(0, expectedCostCents)) {
    throw new ProviderCallError(
      "cost_ceiling_exceeded",
      "The approved provider-cost ceiling does not cover this request"
    );
  }
  return approval;
};

const responseError = async (provider, response) => {
  const payload = await response.json().catch(() => ({}));
  const code =
    response.status === 401 ? provider + "_authentication_failed" :
    response.status === 402 ? provider + "_insufficient_balance" :
    response.status === 403 ? provider + "_access_denied" :
    response.status === 429 ? provider + "_rate_limited" :
    response.status >= 500 ? provider + "_provider_unavailable" :
    provider + "_invalid_request";
  const raw = payload?.error?.message || payload?.detail?.message || payload?.detail || payload?.message;
  throw new ProviderCallError(
    code,
    typeof raw === "string" ? raw.slice(0, 500) : "The provider rejected the request",
    {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      providerRequestId: String(response.headers.get("x-request-id") || "")
    }
  );
};

const lumaVideoOutput = (data) => {
  const candidates = [
    ...(Array.isArray(data?.output) ? data.output : []),
    data?.output,
    data?.assets?.video,
    data?.video
  ];
  for (const candidate of candidates) {
    const url = typeof candidate === "string"
      ? candidate
      : candidate?.url || candidate?.video_url || candidate?.download_url;
    if (/^https:\/\//i.test(String(url || ""))) return String(url);
  }
  return "";
};

const lumaState = (data) => {
  const outputUrl = lumaVideoOutput(data);
  if (outputUrl) return { state: "succeeded", outputUrl };
  const raw = String(data?.state || data?.status || "").trim().toLowerCase();
  if (["failed", "error", "canceled", "cancelled"].includes(raw)) {
    return {
      state: "failed",
      outputUrl: "",
      error: String(data?.failure_reason || data?.error || "The video renderer could not complete the generation").slice(0, 500)
    };
  }
  return { state: "processing", outputUrl: "" };
};

export class ProviderRegistry {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  readiness() {
    const p = this.config.providers;
    const openai = Boolean(p.openai.apiKey) && p.openai.paidEnabled;
    const elevenTechnical =
      Boolean(p.elevenlabs.apiKey) &&
      p.elevenlabs.paidEnabled &&
      p.elevenlabs.billingReady &&
      Number.isInteger(p.elevenlabs.costPerMinuteCents) &&
      p.elevenlabs.costPerMinuteCents > 0;
    const lumaTechnical =
      Boolean(p.luma.apiKey) &&
      p.luma.paidEnabled &&
      p.luma.billingReady &&
      Number.isInteger(p.luma.costPerFiveSecondsCents) &&
      p.luma.costPerFiveSecondsCents > 0;
    const stripeKeyReady =
      (p.stripe.mode === "test" && p.stripe.secretKey.startsWith("sk_test_")) ||
      (p.stripe.mode === "live" && p.stripe.secretKey.startsWith("sk_live_"));
    const stripePricesReady =
      Object.values(p.stripe.prices || {}).every((price) => String(price).startsWith("price_")) &&
      String(p.stripe.creditPackPriceId || "").startsWith("price_");
    const stripe =
      stripeKeyReady &&
      p.stripe.webhookSecret.startsWith("whsec_");
    return {
      openai: {
        configured: openai,
        blocker_codes: [
          ...(!p.openai.apiKey ? ["openai_key_missing"] : []),
          ...(!p.openai.paidEnabled ? ["paid_ai_disabled"] : [])
        ]
      },
      elevenlabs: {
        configured: elevenTechnical,
        commercial_ready: elevenTechnical && p.elevenlabs.commercialApproved,
        blocker_codes: [
          ...(!p.elevenlabs.apiKey ? ["elevenlabs_key_missing"] : []),
          ...(!p.elevenlabs.paidEnabled ? ["paid_audio_disabled"] : []),
          ...(!p.elevenlabs.billingReady ? ["audio_billing_not_ready"] : []),
          ...(!(p.elevenlabs.costPerMinuteCents > 0) ? ["audio_cost_policy_invalid"] : []),
          ...(!p.elevenlabs.commercialApproved ? ["commercial_approval_pending"] : [])
        ]
      },
      luma: {
        configured: lumaTechnical,
        commercial_ready: lumaTechnical && p.luma.commercialApproved,
        blocker_codes: [
          ...(!p.luma.apiKey ? ["luma_key_missing"] : []),
          ...(!p.luma.paidEnabled ? ["paid_media_disabled"] : []),
          ...(!p.luma.billingReady ? ["media_billing_not_ready"] : []),
          ...(!(p.luma.costPerFiveSecondsCents > 0) ? ["media_cost_policy_invalid"] : []),
          ...(!p.luma.commercialApproved ? ["commercial_approval_pending"] : [])
        ]
      },
      stripe: {
        configured: stripe,
        checkout_ready: stripe && stripePricesReady,
        prices_ready: stripePricesReady,
        mode: p.stripe.mode,
        blocker_codes: [
          ...(!p.stripe.secretKey ? ["stripe_key_missing"] : []),
          ...(!p.stripe.webhookSecret ? ["stripe_webhook_secret_missing"] : []),
          ...(!stripeKeyReady && p.stripe.secretKey ? ["stripe_key_mode_mismatch"] : []),
          ...(!stripePricesReady ? ["stripe_price_configuration_incomplete"] : [])
        ]
      }
    };
  }

  assertProviderReady(provider, approval) {
    const readiness = this.readiness()[provider];
    if (!readiness?.configured) {
      throw new ProviderCallError(
        provider + "_not_configured",
        "The provider is not technically ready"
      );
    }
    if (
      (provider === "elevenlabs" || provider === "luma") &&
      !readiness.commercial_ready &&
      approval.scope !== "owner_demo"
    ) {
      throw new ProviderCallError(
        "commercial_approval_required",
        "This provider is available only for a private owner demo until commercial approval is recorded"
      );
    }
  }

  async execute(provider, operation, payload = {}, context = {}) {
    const expectedCost = Math.max(0, Number(payload.estimated_cost_cents) || 0);
    const approval = requireApproval(context, expectedCost);
    this.assertProviderReady(provider, approval);

    if (provider === "openai" && operation === "response") {
      return this.openaiResponse(payload, context);
    }
    if (provider === "elevenlabs" && operation === "compose_music") {
      return this.elevenMusic(payload);
    }
    if (provider === "luma" && operation === "submit_video") {
      return this.lumaSubmit(payload, context);
    }
    if (provider === "luma" && operation === "get_video") {
      return this.lumaGet(payload);
    }
    if (provider === "luma" && operation === "download_video") {
      return this.lumaDownload(payload);
    }
    if (provider === "stripe" && operation === "post") {
      return this.stripePost(payload, context);
    }
    throw new ProviderCallError("unsupported_provider_operation", "Provider operation is not supported", {
      status: 400
    });
  }

  async openaiResponse(payload, context) {
    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.config.providers.openai.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": context.idempotencyKey
      },
      body: JSON.stringify({
        model: payload.model || this.config.providers.openai.model,
        input: payload.input,
        ...(payload.text ? { text: payload.text } : {})
      })
    });
    if (!response.ok) await responseError("openai", response);
    const data = await response.json();
    if (!data?.id) throw new ProviderCallError("openai_invalid_response", "OpenAI returned no response ID");
    return {
      durable: true,
      bytes: Buffer.from(JSON.stringify(data)),
      contentType: "application/json",
      filename: payload.filename || "jericho-response.json",
      metadata: { provider_id: data.id }
    };
  }

  async elevenMusic(payload) {
    const durationMs = Math.max(3000, Math.min(600000, Number(payload.music_length_ms) || 30000));
    const response = await this.fetch(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.config.providers.elevenlabs.apiKey
        },
        body: JSON.stringify({
          prompt: String(payload.prompt || "Create an original instrumental track.").slice(0, 4100),
          music_length_ms: durationMs,
          model_id: "music_v2",
          force_instrumental: Boolean(payload.force_instrumental)
        })
      }
    );
    if (!response.ok) await responseError("elevenlabs", response);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hasId3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const hasFrame = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    if (bytes.length < 1024 || (!hasId3 && !hasFrame)) {
      throw new ProviderCallError("elevenlabs_invalid_audio", "ElevenLabs did not return a valid MP3");
    }
    return {
      durable: true,
      bytes,
      contentType: "audio/mpeg",
      filename: payload.filename || "jericho-audio.mp3",
      metadata: { song_id: String(response.headers.get("song-id") || "") }
    };
  }

  async lumaSubmit(payload, context) {
    const response = await this.fetch("https://agents.lumalabs.ai/v1/generations", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + this.config.providers.luma.apiKey,
        "Content-Type": "application/json",
        "X-Request-Id": context.idempotencyKey
      },
      body: JSON.stringify({
        model: payload.model || "ray-3.2",
        type: "video",
        prompt: String(payload.prompt || "").slice(0, 6000),
        aspect_ratio: payload.aspect_ratio || "16:9",
        video: {
          resolution: payload.resolution || "720p",
          duration: Number(payload.duration_seconds) === 10 ? "10s" : "5s"
        }
      })
    });
    if (!response.ok) await responseError("luma", response);
    const data = await response.json();
    if (!data?.id) throw new ProviderCallError("luma_invalid_response", "Luma returned no generation ID");
    return {
      durable: false,
      providerJobId: data.id,
      data,
      ...lumaState(data)
    };
  }

  async lumaGet(payload) {
    const id = String(payload.provider_job_id || "");
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id)) {
      throw new ProviderCallError("luma_invalid_job_id", "Luma generation ID is invalid", { status: 400 });
    }
    const response = await this.fetch(
      "https://agents.lumalabs.ai/v1/generations/" + encodeURIComponent(id),
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + this.config.providers.luma.apiKey
        }
      }
    );
    if (!response.ok) await responseError("luma", response);
    const data = await response.json();
    return {
      durable: false,
      providerJobId: id,
      data,
      ...lumaState(data)
    };
  }

  async lumaDownload(payload) {
    const url = String(payload.output_url || "");
    if (!/^https:\/\//i.test(url)) {
      throw new ProviderCallError("luma_invalid_output_url", "Luma returned an invalid video URL", {
        status: 502
      });
    }
    const response = await this.fetch(url, {
      headers: { Accept: "video/mp4,video/*;q=0.9,application/octet-stream;q=0.5" }
    });
    if (!response.ok) await responseError("luma", response);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 200_000_000) {
      throw new ProviderCallError("luma_video_too_large", "The rendered video exceeds the secure-copy limit", {
        status: 413
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 200_000_000) {
      throw new ProviderCallError("luma_video_too_large", "The rendered video exceeds the secure-copy limit", {
        status: 413
      });
    }
    const hasFtyp = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
    if (!hasFtyp) {
      throw new ProviderCallError("luma_invalid_video", "Luma did not return a valid MP4", {
        status: 502
      });
    }
    return {
      durable: true,
      bytes,
      contentType: "video/mp4",
      filename: payload.filename || "jericho-video.mp4",
      metadata: {
        provider_id: String(payload.provider_job_id || ""),
        media_verified: true
      }
    };
  }

  async stripePost(payload, context) {
    const path = String(payload.path || "");
    const allowed = new Set([
      "/checkout/sessions",
      "/billing_portal/sessions",
      "/refunds"
    ]);
    if (!allowed.has(path)) {
      throw new ProviderCallError("stripe_operation_not_allowed", "Stripe operation is not allowlisted", {
        status: 400
      });
    }
    if (this.config.providers.stripe.mode === "live" && context.approval?.live_confirmed !== true) {
      throw new ProviderCallError("stripe_live_confirmation_required", "Live Stripe activity requires confirmation");
    }
    const response = await this.fetch("https://api.stripe.com/v1" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.config.providers.stripe.secretKey,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": context.idempotencyKey
      },
      body: new URLSearchParams(payload.params || {})
    });
    if (!response.ok) await responseError("stripe", response);
    return { durable: false, data: await response.json() };
  }
}

export const createProviderRegistry = (config, options) => new ProviderRegistry(config, options);
