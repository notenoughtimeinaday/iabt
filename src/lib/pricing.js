export const IABT_PLANS = [
  {
    id: "free",
    name: "Free",
    eyebrow: "Explore",
    monthlyPrice: 0,
    projectLimit: 1,
    monthlyAiCredits: 0,
    starterAiCredits: 10,
    description: "Validate one app idea before committing.",
    features: [
      "1 cloud project",
      "10 starter IABT credits",
      "Live preview, JSON and standalone HTML",
      "Eligible paid media with credits and approval",
    ],
  },
  {
    id: "builder",
    name: "Builder",
    eyebrow: "Build consistently",
    monthlyPrice: 29,
    projectLimit: 5,
    monthlyAiCredits: 100,
    description: "For makers building and testing several applications.",
    features: [
      "5 cloud projects",
      "100 credits per paid monthly billing cycle",
      "HTML and static ZIP exports",
      "Included credits cover eligible paid production",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    eyebrow: "Ship commercially",
    monthlyPrice: 79,
    projectLimit: 25,
    monthlyAiCredits: 500,
    description: "For founders creating and testing commercial projects.",
    features: [
      "25 cloud projects",
      "500 credits per paid monthly billing cycle",
      "React exports and commercial-use rights",
      "Included credits cover commercial production",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    eyebrow: "Scale your studio",
    monthlyPrice: 199,
    projectLimit: 0,
    monthlyAiCredits: 2000,
    description: "For teams building a portfolio of client applications.",
    features: [
      "Unlimited cloud projects",
      "2,000 credits per paid monthly billing cycle",
      "React source exports for client projects",
      "Included credits cover eligible production",
    ],
  },
];

export const AI_CREDIT_PACK = {
  price: 10,
  credits: 100,
  providerCostPerCreditCents: 3,
  targetGrossMarginPercent: 70,
};

export function getIabtPlan(planId) {
  return IABT_PLANS.find((plan) => plan.id === planId) || IABT_PLANS[0];
}

// Keep the historical catalog for legacy clients. New sale cards come from the
// authenticated server; purchased allowances never come from these cards.
export function billingPlanCards(status) {
  if (!status?.new_offers_enabled) return IABT_PLANS;
  return [IABT_PLANS[0], ...(status.offers || []).map((offer) => ({
    id: offer.id, offerId: offer.id, planKey: offer.plan, name: offer.name,
    eyebrow: offer.introductory ? "First monthly billing period" : "Monthly subscription",
    monthlyPrice: offer.amount_cents / 100, renewalPrice: offer.renewal_amount_cents / 100,
    monthlyAiCredits: offer.monthly_credits, projectLimit: offer.project_limit,
    introductory: offer.introductory, disclosure: offer.disclosure, disclosureVersion: offer.disclosure_version,
    description: offer.introductory ? "Meet Jericho, then continue with Starter." : "Credits are added after each successful monthly payment.",
    features: [
      `${offer.project_limit} cloud project${offer.project_limit === 1 ? "" : "s"}`,
      `${offer.monthly_credits} credits per paid monthly billing cycle`,
      offer.react_export_enabled ? "React and static ZIP exports" : offer.static_zip_export_enabled ? "HTML and static ZIP exports" : "HTML exports",
      ...(offer.commercial_use_enabled ? ["Commercial-use rights"] : [])
    ]
  }))];
}

export function purchasedPlanSummary(entitlement) {
  const contract = entitlement?.billing_price_contract;
  const plan = entitlement?.plan || "free";
  return { plan, legacy: contract?.catalog_version === "legacy-v1",
    monthlyCredits: plan !== "free" ? Number(contract?.monthly_credits ?? entitlement?.ai_monthly_limit ?? 0) : 0,
    nextRenewal: entitlement?.current_period_end || null };
}
