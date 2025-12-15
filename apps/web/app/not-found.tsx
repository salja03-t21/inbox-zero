import { ErrorPage } from "@/components/ErrorPage";
import { MinimalLayout } from "@/components/layouts/MinimalLayout";

export default function NotFound() {
  return (
    <MinimalLayout>
      <ErrorPage
        title="Page Not Found"
        description="The page you are looking for could not be found."
      />
    </MinimalLayout>
  );
}
