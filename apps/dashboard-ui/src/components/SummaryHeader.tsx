"use client";

import { useAuth } from "@/lib/auth-context";

function clinicNameFromEnv(): string | undefined {
  const v = process.env.NEXT_PUBLIC_CLINIC_NAME;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function clinicAddressFromEnv(): string | undefined {
  const v = process.env.NEXT_PUBLIC_CLINIC_ADDRESS;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export default function SummaryHeader() {
  const { scope } = useAuth();
  const selectedHospital = scope.hospitals.find(
    (h) => h.hospital_id === scope.assignedHospitalId
  );
  const name = selectedHospital?.hospital_name ?? clinicNameFromEnv() ?? null;
  const address = selectedHospital?.address ?? clinicAddressFromEnv() ?? null;

  return (
    <header className="mb-3">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
        {name ?? "동물병원"}
      </h1>
      {address ? (
        <p className="mt-1 text-sm leading-snug text-zinc-400">{address}</p>
      ) : null}
    </header>
  );
}
