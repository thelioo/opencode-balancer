export type StatusAccount = {
    providerID: string;
    alias: string;
};

export function formatBalancerStatus(input: {
    selected?: StatusAccount;
    sessionActive?: StatusAccount;
    sessionProviderID?: string;
    balancing?: { providerID: string; alias?: string; modelID: string };
    usage?: string;
}) {
    const withUsage = (value: string) => (input.usage ? `${value} · ${input.usage}` : value);

    if (input.balancing) {
        const account = input.balancing.alias
            ? `${input.balancing.providerID}/${input.balancing.alias}`
            : input.balancing.providerID;
        return withUsage(account);
    }

    if (!input.selected) {
        if (input.sessionProviderID) return withUsage(`${input.sessionProviderID}/${input.sessionActive?.alias ?? "none"}`);
        return withUsage("balancer");
    }

    const selected = `${input.selected.providerID}/${input.selected.alias}`;
    return withUsage(selected);
}
