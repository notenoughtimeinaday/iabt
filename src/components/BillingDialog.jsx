import React, { useState } from "react";
import { Check, CreditCard, Loader2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

const PLANS = [
  {
    id: "free",
    name: "Free",
    eyebrow: "Explore",
    description: "Start building and validate your SaaS idea.",
    features: ["5 AI generations per hour", "Up to 3 cloud projects", "HTML and JSON exports"],
  },
  {
    id: "builder",
    name: "Builder",
    eyebrow: "Build consistently",
    description: "For serious makers shipping multiple applications.",
    features: ["30 AI generations per hour", "Up to 25 cloud projects", "HTML, ZIP, React and React ZIP"],
  },
  {
    id: "pro",
    name: "Pro",
    eyebrow: "Scale your studio",
    description: "For high-volume creation and a growing app portfolio.",
    features: ["100 AI generations per hour", "Unlimited cloud projects", "All production export formats"],
  },
];

export default function BillingDialog({ open, onOpenChange, entitlement }) {
  const { toast } = useToast();
  const [busyPlan, setBusyPlan] = useState("");
  const currentPlan = String(entitlement?.plan || "free").toLowerCase();
  const foundingAccess =
    currentPlan === "pro" &&
    entitlement?.billing_provider === "none" &&
    entitlement?.status === "active";

  async function startCheckout(plan) {
    setBusyPlan(plan);
    try {
      const response = await base44.functions.invoke("stripe-create-checkout", { plan });
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Checkout could not be started.";
      toast({
        title: "Stripe test checkout is not ready",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusyPlan("");
    }
  }

  async function openBillingPortal() {
    setBusyPlan("portal");
    try {
      const response = await base44.functions.invoke("stripe-customer-portal", {});
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Stripe did not return a billing portal link.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Billing portal could not be opened.";
      toast({ title: "Billing portal unavailable", description: message, variant: "destructive" });
    } finally {
      setBusyPlan("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="iabt-billing-dialog">
        <DialogHeader className="iabt-billing-heading">
          <div className="iabt-billing-icon"><CreditCard /></div>
          <div>
            <DialogTitle>Plans & billing</DialogTitle>
            <DialogDescription>
              Choose the workspace capacity that fits how you build. Stripe remains locked to test mode until launch approval.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="iabt-billing-trust">
          <span><ShieldCheck /> Secure server-side checkout</span>
          <span><Sparkles /> AI usage by account</span>
          <span><Zap /> Change plans through Stripe</span>
        </div>

        <div className="iabt-plan-grid">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isFeatured = plan.id === "builder";
            const cardClassName =
              "iabt-plan-card" +
              (isFeatured ? " is-featured" : "") +
              (isCurrent ? " is-current" : "");
            return (
              <article key={plan.id} className={cardClassName}>
                <div className="iabt-plan-card-top">
                  <span>{plan.eyebrow}</span>
                  {isCurrent && <strong>Current plan</strong>}
                </div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}><Check /> {feature}</li>
                  ))}
                </ul>

                {plan.id === "free" ? (
                  <Button variant="outline" disabled className="w-full">
                    {isCurrent ? "Current plan" : "Included"}
                  </Button>
                ) : isCurrent && entitlement?.billing_provider === "stripe" ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={openBillingPortal}
                    disabled={Boolean(busyPlan)}
                  >
                    {busyPlan === "portal" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Manage billing
                  </Button>
                ) : isCurrent && foundingAccess ? (
                  <Button variant="outline" disabled className="w-full">Founding access</Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={isFeatured ? "default" : "outline"}
                    onClick={() => startCheckout(plan.id)}
                    disabled={Boolean(busyPlan)}
                  >
                    {busyPlan === plan.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Try {plan.name} checkout
                  </Button>
                )}
              </article>
            );
          })}
        </div>

        <p className="iabt-billing-note">
          Test mode uses Stripe test cards only. Real charges remain disabled until live pricing and live credentials are explicitly approved.
        </p>
      </DialogContent>
    </Dialog>
  );
}
