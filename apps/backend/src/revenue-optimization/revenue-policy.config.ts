// Compatibility shim — runtime authority is RuntimeSettingsService / RevenuePolicy table.
// Env vars are bootstrap defaults only (see settings.defaults.ts).

export {
  bootstrapRevenueDefaults as loadRevenuePolicy,
  CODE_REVENUE_DEFAULTS as REVENUE_POLICY,
} from "../settings/settings.defaults";

export type { RevenuePolicy } from "@ai-cmo/contracts";
