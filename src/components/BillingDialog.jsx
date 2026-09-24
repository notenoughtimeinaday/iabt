import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CreditCard, Loader2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { base44 } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { IABT_PLANS } from "@/lib/pricing";
import { billingViewState } from "@/lib/billing-state";

export default function BillingDialog({ open, onOpenChange, entitlement, billingStatus }) {
  const { toast } = useToast();
  const [busyPlan, setBusyPlan] = useState("");
  const currentPlan = String(entitlement?.plan || "free").toLowerCase();
  const billing = billingViewState(entitlement, billingStatus);
  const billingMode = billing.mode;
  const billingReady = billing.checkoutReady;
  const hasStripeSubscription = billing.hasSubscription;
  const checkoutKeys = useRef({});
  const retryKey = (action) => {
    if (!checkoutKeys.current[action]) checkoutKeys.current[action] = crypto.randomUUID();
    return checkoutKeys.current[action];
  };
  const foundingAccess =
    currentPlan === "pro" &&
    entitlement?.billing_provider === "none" &&
    entitlement?.status === "active";
  const remainingCredits = billing.credits;

  async function startCheckout(plan) {
    setBusyPlan(plan);
    try {
      const response = await base44.functions.invoke("stripe-create-checkout", { plan, idempotency_key: retryKey(plan) });
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Checkout could not be started.";
      toast({
        title: "Stripe checkout is not ready",
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
      const response = await base44.functions.invoke("stripe-create-credit-checkout", { idempotency_key: retryKey("credits") });
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Stripe did not return a checkout link.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Credit checkout could not be started.";
      toast({
        title: "Stripe credit checkout is not ready",
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
              {!billing.loaded ? "Billing availability is being checked."
                : billingMode === "live"
                  ? "Review the price, currency and taxes in Stripe before paying."
                  : "Test billing only. Test checkout does not create real charges."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="iabt-billing-trust">
          <span><ShieldCheck /> Secure server-side checkout</span>
          <span><Sparkles /> {remainingCredits.toLocaleString()} IABT credits available</span>
          <span><Zap /> Change plans through Stripe</span>
        </div>

        {!billingReady && billing.loaded && (
          <div className="iabt-billing-economics" role="status">
            <div><ShieldCheck /></div>
            <p>
              <strong>New purchases are currently unavailable.</strong>
              <span>Your existing credits remain available. {billing.portalReady ? "Existing subscribers can still open billing management." : "Try again after billing setup is completed."}</span>
            </p>
          </div>
        )}

        <div className="iabt-billing-economics">
          <div><Zap /></div>
          <p><strong>Credits fund your creation work.</strong><span>Free accounts receive 10 starter credits. Paid plans add credits after each verified monthly payment. Supported private work can run automatically within your balance; paid-provider work requires quote approval. A saved file does not guarantee a finished, tested application.</span></p>
        </div>

        {billing.needsPaymentAttention && <p role="status" className="iabt-billing-note">Your subscription needs attention ({billing.subscriptionStatus.replaceAll("_", " ")}). Open billing management to review payment or resume your subscription.</p>}
        {entitlement?.cancel_at_period_end && <p role="status" className="iabt-billing-note">Cancellation is scheduled at the end of your billing period. Purchased credits remain available.</p>}

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
                  <strong>{plan.id === "free" ? "$0" : "Monthly plan"}</strong>
                  <span>{plan.id === "free" ? "to start" : "price confirmed in Stripe"}</span>
                </div>
                <p>{plan.description}</p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}><Check /> {feature}</li>
                  ))}
                </ul>

                {hasStripeSubscription ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={openBillingPortal}
                    disabled={Boolean(busyPlan) || !billing.portalReady}
                  >
                    {busyPlan === "portal" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {isCurrent
                      ? "Manage billing"
                      : plan.id === "free"
                        ? "Manage or cancel in Stripe"
                        : "Change plan in Stripe"}
                  </Button>
                ) : plan.id === "free" ? (
                  <Button variant="outline" disabled className="w-full">
                    {isCurrent ? "Current plan" : "Included"}
                  </Button>
                ) : isCurrent && foundingAccess ? (
                  <Button variant="outline" disabled className="w-full">Founding access</Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={isFeatured ? "default" : "outline"}
                    onClick={() => startCheckout(plan.id)}
                    disabled={Boolean(busyPlan) || !billingReady}
                  >
                    {busyPlan === plan.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {billingMode === "live" ? `Choose ${plan.name}` : `Test ${plan.name} checkout`}
                  </Button>
                )}
              </article>
            );
          })}
        </div>

        <div className="iabt-credit-pack">
          <div>
            <span className="iabt-credit-pack-kicker">Flexible creation capacity</span>
            <strong>{billing.creditPackSize ? `${billing.creditPackSize.toLocaleString()} extra IABT credits` : "Extra IABT credit pack"}</strong>
            <p>Purchased credits remain available until used. Review the price and taxes in Stripe before paying. Paid-provider work requires an accepted quote; supported private work can run automatically within your credit balance.</p>
          </div>
          <Button variant="outline" onClick={startCreditCheckout} disabled={Boolean(busyPlan) || !billingReady}>
            {busyPlan === "credits" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {billingMode === "live" ? "Buy credit pack" : "Test credit-pack checkout"}
          </Button>
        </div>

        <p className="iabt-billing-note">
          {!billing.loaded ? "Billing status is unavailable. Reopen this page once your account has loaded." : billingMode === "live"
            ? billingReady
              ? "Live checkout can create real charges after you confirm payment in Stripe. Credits appear only after payment is verified."
              : "Live purchases are unavailable until billing setup is completed."
            : billingReady
              ? "Test checkout is available. Credits from test payments are for testing this environment."
              : "Test checkout is unavailable until billing setup is completed."}
        </p>
        <p className="iabt-billing-legal">
          Purchases are subject to the <Link to="/terms">Terms</Link>,{" "}
          <Link to="/privacy">Privacy Notice</Link>, and <Link to="/acceptable-use">Acceptable Use Policy</Link>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
