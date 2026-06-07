export function selectedRowColors<TColor>(theme: {
    text: TColor;
    textMuted?: TColor;
    backgroundElement: TColor;
    background?: TColor;
    accent?: TColor;
}) {
    const bg = theme.backgroundElement;
    const textContrast = contrast(theme.text, bg);
    const backgroundContrast = theme.background === undefined ? undefined : contrast(theme.background, bg);
    const fg = backgroundContrast !== undefined && backgroundContrast > textContrast ? theme.background : theme.text;
    return { fg, bg };
}

function contrast<TColor>(a: TColor, b: TColor) {
    const ca = channels(a);
    const cb = channels(b);
    if (!ca || !cb) return 0;
    const la = luminance(ca);
    const lb = luminance(cb);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

function channels(value: unknown) {
    if (!value || typeof value !== "object") return undefined;
    const color = value as Record<string, unknown>;
    const r = numberChannel(color.r ?? color.red);
    const g = numberChannel(color.g ?? color.green);
    const b = numberChannel(color.b ?? color.blue);
    return r === undefined || g === undefined || b === undefined ? undefined : { r, g, b };
}

function numberChannel(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : undefined;
}

function luminance(color: { r: number; g: number; b: number }) {
    const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
