import { AdminUsersManagement } from "@/app/(app)/admin/users/AdminUsersManagement";
import { TopSection } from "@/components/TopSection";
import { auth } from "@/utils/auth";
import { ErrorPage } from "@/components/ErrorPage";
import { isAdmin } from "@/utils/admin";

export const maxDuration = 300;

export default async function AdminUsersPage() {
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
      <TopSection
        title="User Management"
        descriptionComponent={
          <p className="text-gray-700">
            Manage admin status for users in the system
          </p>
        }
      />
      <div className="content-container">
        <AdminUsersManagement />
      </div>
    </div>
  );
}
