import { redirect } from "next/navigation";

export default function HospitalLegacyRedirectPage() {
  redirect("/dashboard/sales");
}
