import { metadataFor } from "../lib/metadata";
import { headers } from "next/headers";
import { requestPreferences } from "../lib/request-preferences";
import "./globals.css";

export const metadata = metadataFor("zh");
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = (await headers()).get("x-travel-agent-locale") === "en" ? "en" : "zh-CN";
  const preferences = await requestPreferences();
  return (
    <html lang={language} data-theme={preferences.theme}>
      <body>{children}</body>
    </html>
  );
}
