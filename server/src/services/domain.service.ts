import { getProfileDomain } from "./profile-loader.service";

export type RuntimeDomain =
  | "immobilier"
  | "garage"
  | "generic"
  | "oraclesentinel";

export function normalizeDomain(value: string | null | undefined): RuntimeDomain {
  const raw = (value || "").toLowerCase().trim();

  if (raw === "garage" || raw === "automobile" || raw === "auto") {
    return "garage";
  }
  if (raw === "immobilier" || raw === "immo") {
    return "immobilier";
  }
  if (raw === "oraclesentinel" || raw === "tsindustry" || raw === "oracle") {
    return "oraclesentinel";
  }
  if (raw === "generic") {
    return "generic";
  }

  return "immobilier";
}

export function getRuntimeDomain(): RuntimeDomain {
  return normalizeDomain(getProfileDomain());
}
