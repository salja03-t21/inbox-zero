"use client";

import { ApiKeysSection } from "@/app/(app)/[emailAccountId]/settings/ApiKeysSection";
import { BillingSection } from "@/app/(app)/[emailAccountId]/settings/BillingSection";
import { DeleteSection } from "@/app/(app)/[emailAccountId]/settings/DeleteSection";
import { MeetingSchedulerSection } from "@/app/(app)/[emailAccountId]/settings/MeetingSchedulerSection";
import { ModelSection } from "@/app/(app)/[emailAccountId]/settings/ModelSection";
import { MultiAccountSection } from "@/app/(app)/[emailAccountId]/settings/MultiAccountSection";
import { ResetAnalyticsSection } from "@/app/(app)/[emailAccountId]/settings/ResetAnalyticsSection";
import { SharedMailboxSection } from "@/app/(app)/[emailAccountId]/settings/SharedMailboxSection";
import { WebhookSection } from "@/app/(app)/[emailAccountId]/settings/WebhookSection";
import { FormSection, FormWrapper } from "@/components/Form";
import { PageHeader } from "@/components/PageHeader";
import { TabsToolbar } from "@/components/TabsToolbar";
import { SectionDescription } from "@/components/Typography";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useUser } from "@/hooks/useUser";
import { isOrganizationAdmin } from "@/utils/organizations/roles";

export default function SettingsPage() {
  const { emailAccount } = useAccount();
  const { data: user } = useUser();

  const currentEmailAccountMembers =
    user?.members?.filter(
      (member) => member.emailAccountId === emailAccount?.id,
    ) || [];
  const hasOrganization = currentEmailAccountMembers.length > 0;
  const isAdmin = isOrganizationAdmin(currentEmailAccountMembers);

  // If user is in an organization, only admins can access settings
  // If user is not in an organization, they can access their own settings
  if (hasOrganization && !isAdmin) {
    return (
      <div className="content-container">
        <PageHeader
          title="Access Denied"
          description="You must be an organization administrator to access settings."
        />
      </div>
    );
  }

  return (
    <div>
      <div className="content-container mb-4">
        <PageHeader title="Settings" description="Manage your settings." />
      </div>

      <Tabs defaultValue="user">
        <TabsToolbar>
          <div className="w-full overflow-x-auto">
            <TabsList>
              <TabsTrigger value="user">User</TabsTrigger>
              <TabsTrigger value="email">Email Account</TabsTrigger>
            </TabsList>
          </div>
        </TabsToolbar>

        <TabsContent value="user">
          <FormWrapper>
            <MultiAccountSection />
            <BillingSection />
            <ModelSection />
            <WebhookSection />
            <ApiKeysSection />
            <DeleteSection />
          </FormWrapper>
        </TabsContent>

        <TabsContent value="email" className="content-container mb-10">
          {emailAccount && (
            <FormWrapper>
              <FormSection className="py-4">
                <SectionDescription>
                  Settings for {emailAccount?.email}
                </SectionDescription>
              </FormSection>

              <MeetingSchedulerSection />
              <SharedMailboxSection />
              <ResetAnalyticsSection />

              {/* this is only used in Gmail when sending a new message. disabling for now. */}
              {/* <SignatureSectionForm signature={user.signature} /> */}
              {/* <EmailUpdatesSection
                summaryEmailFrequency={data?.summaryEmailFrequency}
                mutate={mutate}
              /> */}
            </FormWrapper>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
