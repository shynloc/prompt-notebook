import { ExtensionConnect } from "@/components/extension/extension-connect";

export default async function ExtensionConnectPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const value = (key: string) => typeof values[key] === "string" ? values[key] : "";
  return <ExtensionConnect
    codeChallenge={value("code_challenge")}
    redirectUri={value("redirect_uri")}
    state={value("state")}
    deviceName={value("device_name") || "Chrome"}
  />;
}

