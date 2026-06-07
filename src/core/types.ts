export type AuthInfo =
    | { type: "api"; key: string; metadata?: Record<string, string> }
    | {
          type: "oauth";
          refresh: string;
          access: string;
          expires: number;
          accountId?: string;
          enterpriseUrl?: string;
          metadata?: Record<string, string>;
      }
    | { type: "wellknown"; key: string; token: string; metadata?: Record<string, string> };

export type Account = {
    providerID: string;
    alias: string;
    auth: AuthInfo;
    authType: AuthInfo["type"];
    createdAt: number;
    updatedAt: number;
    lastUsedAt?: number;
    rateLimitedUntil?: number;
    failures: number;
    disabled: boolean;
};

export type ProviderState = {
    providerID: string;
    activeAlias?: string;
    updatedAt: number;
    metadata: Record<string, string>;
};

export type SelectedModel = {
    providerID: string;
    modelID: string;
};

export type PendingConnection = {
    id: string;
    providerID: string;
    auth: AuthInfo;
    authType: AuthInfo["type"];
    source: "auth-file" | "http" | "oauth-callback";
    capturedAt: number;
    promptStatus: "new" | "prompted" | "dismissed";
};

export type BalancerEventType =
    | "pending_connection_captured"
    | "account_saved"
    | "account_activated"
    | "account_removed"
    | "usage_refreshed"
    | "usage_unavailable"
    | "rate_limit_detected"
    | "failover_performed";

export type BalancerEvent = {
    id: string;
    type: BalancerEventType;
    providerID?: string;
    alias?: string;
    message: string;
    createdAt: number;
    metadata: Record<string, string>;
};
