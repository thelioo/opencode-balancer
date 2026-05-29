import type { AuthInfo, PendingRequest } from "./types";

export const INTERNAL_REQUEST_HEADER = "x-opencode-balancer-request";
export const BALANCER_ALIAS_INPUT = "__opencode_balancer_alias";
export const BALANCER_METADATA_KEY = "opencodeBalancerCommand";
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

export const state = {
    fetchPatched: false,
    pendingRequests: new Map<string, PendingRequest>(),
    pendingOauthAlias: new Map<string, string>(),
    suppressAuthCaptureUntil: new Map<string, number>(),
    lastAuthSnapshot: {} as Record<string, AuthInfo>,
    watchStarted: false,
};

export function now() {
    return Date.now();
}
