import { Button } from "@/components/Button";
import { PageHeading, TypographyP } from "@/components/Typography";
import { MinimalLayout } from "@/components/layouts/MinimalLayout";
import { CardBasic } from "@/components/ui/card";

// same component as not-found
export default function ThankYouPage() {
  return (
    <MinimalLayout>
      <div className="pb-40 pt-60">
        <CardBasic className="mx-auto max-w-xl text-center">
          <PageHeading>Thank you!</PageHeading>
          <div className="mt-2">
            <TypographyP>
              Your premium purchase was successful. Thank you for supporting us!
            </TypographyP>
          </div>
          <Button className="mt-4" size="xl" link={{ href: "/setup" }}>
            Continue
          </Button>
        </CardBasic>
      </div>
    </MinimalLayout>
  );
}
