export const IABT_PLANS = [
  {
    id: "free",
    name: "Free",
    eyebrow: "Explore",
    monthlyPrice: 0,
    projectLimit: 1,
    monthlyAiCredits: 10,
    description: "Validate one app idea before committing.",
    features: [
      "1 cloud project",
      "10 IABT credits each month",
      "Live preview, JSON and standalone HTML",
      "Paid media available with purchased credits",
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
      "100 IABT credits each month",
      "HTML and static ZIP exports",
      "Paid production available through purchased credits",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    eyebrow: "Ship commercially",
    monthlyPrice: 79,
    projectLimit: 25,
    monthlyAiCredits: 500,
    description: "For founders shipping production-ready SaaS products.",
    features: [
      "25 cloud projects",
      "500 IABT credits each month",
      "React exports and commercial-use rights",
      "Commercial exports plus production-credit access",
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
      "2,000 IABT credits each month",
      "White-label exports and up to 5 team seats",
      "Team controls plus production-credit access",
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
