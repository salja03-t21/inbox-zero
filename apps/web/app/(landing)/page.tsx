import { redirect } from "next/navigation";
import { auth } from "@/utils/auth";
import { WELCOME_PATH } from "@/utils/config";

export default async function Home() {
  // Check if user is already authenticated
  const session = await auth();

  if (session?.user) {
    // If authenticated, redirect to app
    redirect(WELCOME_PATH);
  }

  // If not authenticated, redirect to login page
  redirect("/login");
}
