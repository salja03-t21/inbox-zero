import { AdminUsersManagement } from "@/app/(app)/admin/users/AdminUsersManagement";
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
    <div className="px-4 py-8 md:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage admin status for users in the system
        </p>
      </div>
      <AdminUsersManagement />
    </div>
  );
}
