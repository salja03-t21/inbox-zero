"use client";

import type React from "react";
import { Provider } from "jotai";
import { jotaiStore } from "@/store";
import { ThemeProvider } from "@/components/theme-provider";
import { ChatProvider } from "@/providers/ChatProvider";

// NOTE: NuqsAdapter and ComposeModalProvider are provided by GlobalProviders in root layout
// Do NOT add them here to avoid duplicate provider nesting which causes React Error #310
export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <Provider store={jotaiStore}>
        <ChatProvider>{props.children}</ChatProvider>
      </Provider>
    </ThemeProvider>
  );
}
