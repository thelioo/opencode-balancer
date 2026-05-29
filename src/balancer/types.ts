export type AuthInfo =
    | { type: "api"; key: string; metadata?: Record<string, string> }
    | {
          type: "oauth";
          refresh: string;
          access: string;
          expires: number;
          accountId?: string;
          enterpriseUrl?: string;
      }
    | { type: "wellknown"; key: string; token: string };

export type Account = {
    alias: string;
    providerID: string;
    auth: AuthInfo;
    createdAt: number;
    updatedAt: number;
    lastUsedAt?: number;
    rateLimitedUntil?: number;
    failures?: number;
};

export type ProviderState = {
    active?: string;
    accounts: Record<string, Account>;
};

export type Store = {
    version: 1;
    providers: Record<string, ProviderState>;
    lastCaptured?: {
        providerID: string;
        auth: AuthInfo;
        capturedAt: number;
        source: "auth-file" | "http" | "oauth-callback";
    };
};

export type PendingRequest = {
    providerID: string;
    account?: Account;
};
