import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function OAuthConsent() {
  return (
    <AuthLayout icon={ShieldCheck} title="Connection unavailable">
      <p className="text-sm text-muted-foreground">
        External AI-client authorization is not available in this environment yet.
        No access has been granted.
      </p>
      <Link to="/studio" className="mt-4 inline-block underline">
        Return to Studio
      </Link>
    </AuthLayout>
  );
}
