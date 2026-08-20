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
import { AI_CREDIT_PACK, IABT_PLANS } from "@/lib/pricing";

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

  async function startCreditCheckout() {
    setBusyPlan("credits");
    try {
      const response = await base44.functions.invoke("stripe-create-credit-checkout", {});
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Credit checkout could not be started.";
      toast({
        title: "Stripe test credit checkout is not ready",
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
          {IABT_PLANS.map((plan) => {
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
                <div className="iabt-plan-price">
                  <strong>{plan.monthlyPrice ? `$${plan.monthlyPrice}` : "$0"}</strong>
                  <span>/ month</span>
                </div>
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

        <div className="iabt-credit-pack">
          <div>
            <span className="iabt-credit-pack-kicker">Flexible AI capacity</span>
            <strong>{AI_CREDIT_PACK.credits} extra AI generations for {"$" + AI_CREDIT_PACK.price}</strong>
            <p>One-time credit packs never expire and are used only after the plan's monthly allowance.</p>
          </div>
          <Button variant="outline" onClick={startCreditCheckout} disabled={Boolean(busyPlan)}>
            {busyPlan === "credits" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Try credit-pack checkout
          </Button>
        </div>

        <p className="iabt-billing-note">
          All checkout routes are locked to Stripe test mode. Test cards cannot create real charges. Live billing remains disabled until pricing, policies, taxes, support, and production credentials are explicitly approved.
        </p>
      </DialogContent>
    </Dialog>
  );
}
