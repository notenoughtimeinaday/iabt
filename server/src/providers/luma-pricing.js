// Ray 3.2 SDR generation (text/image-to-video) is priced per clip, not
// linearly per second: the documented 10s total is three times the 5s total.
// Source checked 2026-10-09: https://docs.agents.lumalabs.ai/guides/pricing/
// The configured base is the operator's 720p/5s estimate, not a provider cap.
export const estimateLumaVideoCostCents = (costPerFiveSecondsCents, durationSeconds = 5) => {
  const seconds = Number(durationSeconds);
  if (![5, 10].includes(seconds)) {
    throw Object.assign(new Error("The quoted video profile supports only 5 or 10 seconds."), { status: 422, code: "luma_video_profile_unsupported" });
  }
  const base = Number(costPerFiveSecondsCents);
  const cost = base * (seconds === 10 ? 3 : 1);
  if (!Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(cost)) {
    throw Object.assign(new Error("A valid provider cost estimate is required before video generation."), { status: 409, code: "media_cost_policy_invalid" });
  }
  return cost;
};
