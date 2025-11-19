import { AdminUpgradeUserForm } from "@/app/(app)/admin/AdminUpgradeUserForm";
import { AdminUserControls } from "@/app/(app)/admin/AdminUserControls";
import { TopSection } from "@/components/TopSection";
import { auth } from "@/utils/auth";
import { ErrorPage } from "@/components/ErrorPage";
import { isAdmin } from "@/utils/admin";
import {
  AdminSyncStripe,
  AdminSyncStripeCustomers,
} from "@/app/(app)/admin/AdminSyncStripe";
import { RegisterSSOModal } from "@/app/(app)/admin/RegisterSSOModal";
import { AdminHashEmail } from "@/app/(app)/admin/AdminHashEmail";
import { GmailUrlConverter } from "@/app/(app)/admin/GmailUrlConverter";
import { DebugLabels } from "@/app/(app)/admin/DebugLabels";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldCheckIcon } from "lucide-react";

// NOTE: Turn on Fluid Compute on Vercel to allow for 800 seconds max duration
export const maxDuration = 800;

export default async function AdminPage() {
  const session = await auth();

  if (
    !(await isAdmin({ email: session?.user.email, userId: session?.user.id }))
  ) {
    return (
      <ErrorPage
        title="No Access"
        description="You do not have permission to access this page."
      />
    );
  }

  return (
    <div>
      <TopSection title="Admin" />

      <div className="m-8 space-y-8">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Links</h2>
          <div className="flex gap-2">
            <Link href="/admin/users">
              <Button variant="outline" className="gap-2">
                <ShieldCheckIcon className="h-4 w-4" />
                User Management
              </Button>
            </Link>
          </div>
        </div>

        <AdminUpgradeUserForm />
        <AdminUserControls />
        <AdminHashEmail />
        <GmailUrlConverter />
        <DebugLabels />
        <RegisterSSOModal />

        <div className="flex gap-2">
          <AdminSyncStripe />
          <AdminSyncStripeCustomers />
        </div>
      </div>
    </div>
  );
}
