type ProviderLike = {
    id: string;
    name?: string;
    models?: Record<string, ModelLike>;
};

type ModelLike = {
    id?: string;
    name?: string;
    status?: string;
    release_date?: string;
};

export type ProviderModelOption = {
    providerID: string;
    providerName: string;
    modelID: string;
    title: string;
};

export function providerModelOptions(providers: readonly ProviderLike[], providerID: string): ProviderModelOption[] {
    const provider = providers.find((item) => item.id === providerID);
    if (!provider?.models) return [];

    return Object.entries(provider.models)
        .filter(([, model]) => model.status !== "deprecated")
        .map(([modelID, model]) => ({
            providerID: provider.id,
            providerName: provider.name ?? provider.id,
            modelID: model.id ?? modelID,
            title: model.name ?? model.id ?? modelID,
            releaseDate: model.release_date ?? "",
        }))
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title))
        .map(({ releaseDate: _releaseDate, ...option }) => option);
}
