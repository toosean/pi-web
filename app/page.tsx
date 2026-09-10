import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { ToolInputFormatProvider } from "@/hooks/useToolInputFormat";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <ToolInputFormatProvider>
          <AppShell />
        </ToolInputFormatProvider>
      </I18nProvider>
    </Suspense>
  );
}
