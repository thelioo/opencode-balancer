export type SelectedAccountBarSyncDeps = {
    dialogOpen: () => boolean;
    selectedProvider: () => string | undefined;
    currentProvider: () => string | undefined;
    applyProvider: (providerID: string) => Promise<boolean>;
};

export function createSelectedAccountBarSync(deps: SelectedAccountBarSyncDeps) {
    let applying = false;
    let appliedProvider: string | undefined;

    const currentProvider = () => appliedProvider ?? deps.currentProvider();

    return {
        currentProvider,
        maybeSync: async () => {
            if (applying || deps.dialogOpen()) return false;

            const selected = deps.selectedProvider();
            if (!selected || selected === currentProvider()) return false;

            applying = true;
            try {
                const applied = await deps.applyProvider(selected);
                if (applied) appliedProvider = selected;
                return applied;
            } finally {
                applying = false;
            }
        },
    };
}
