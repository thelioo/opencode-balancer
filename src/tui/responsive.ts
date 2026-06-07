export type LayoutMode = "compact" | "full";

export function dashboardLayoutMode(size: { width?: number; height?: number }): LayoutMode {
    const width = size.width ?? 999;
    const height = size.height ?? 999;
    return width < 100 || height < 26 ? "compact" : "full";
}

export function visibleRecentEventLimit(mode: LayoutMode): number {
    return mode === "compact" ? 5 : 10;
}

export function dashboardContentHeight(size: { height?: number }): number {
    const height = size.height ?? 28;
    return Math.max(6, height - 8);
}
