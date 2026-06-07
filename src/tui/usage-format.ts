export function formatUsageBar(percent: number | undefined, width = 8) {
    if (percent === undefined) return `${"─".repeat(width)} --`;
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    const filled = Math.max(0, Math.min(width, Math.ceil((value / 100) * width)));
    return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${value}%`;
}

export function truncateMiddle(value: string, maxLength: number) {
    if (value.length <= maxLength) return value;
    if (maxLength <= 1) return "…";
    const left = Math.ceil((maxLength - 1) / 2);
    const right = Math.floor((maxLength - 1) / 2);
    return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}
