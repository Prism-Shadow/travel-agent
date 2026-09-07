import Home from "../../components/home";
import { metadataFor } from "../../lib/metadata";
import { requestPreferences } from "../../lib/request-preferences";

export const metadata = metadataFor("en");
export default async function Page() {
  return <Home locale="en" preferences={await requestPreferences()} />;
}
