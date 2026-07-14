/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import {
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	getBalancingEnabled,
	listProviderPriority,
	moveProvider,
	type PriorityEntry,
	resolveActiveSelection,
	setBalancingEnabled,
	setProviderEnabled,
} from "../../core/priority";
import {
	movePriorityFocus,
	type PriorityFocusArea,
	prioritySelectionMarker,
	reducePriorityKey,
} from "../priority-keys";
import { dashboardLayoutMode } from "../responsive";
import { selectedRowColors } from "../selection-colors";
import type { BalancerTuiState } from "../state";

type KeyLike = { name?: string; shift?: boolean };

function modelLabel(api: TuiPluginApi, entry: PriorityEntry): string {
	if (!entry.modelID) return "(sem modelo — Enter)";
	const provider = api.state.provider.find(
		(item) => item.id === entry.providerID,
	);
	const model = provider?.models?.[entry.modelID];
	return model?.name ?? entry.modelID;
}

export function PriorityScreen(props: {
	api: TuiPluginApi;
	state: BalancerTuiState;
	onBack: () => void;
	openModelPicker: (providerID: string, onComplete?: () => void) => void;
}) {
	const theme = () => props.api.theme.current;
	const selectedColors = () => selectedRowColors(theme());
	const db = props.state.db;

	const [entries, setEntries] = createSignal<PriorityEntry[]>(
		listProviderPriority(db),
	);
	const [balancing, setBalancing] = createSignal(getBalancingEnabled(db));
	const [cursor, setCursor] = createSignal(0);
	const [focusArea, setFocusArea] = createSignal<PriorityFocusArea>("content");
	const compact = () =>
		dashboardLayoutMode({
			height: (props.api.renderer as unknown as { height?: number }).height,
			width: (props.api.renderer as unknown as { width?: number }).width,
		}) === "compact";

	const refresh = () => {
		const next = listProviderPriority(db);
		setEntries(next);
		setBalancing(getBalancingEnabled(db));
		setCursor((value) =>
			Math.max(0, Math.min(value, Math.max(0, next.length - 1))),
		);
	};
	refresh();
	const timer = setInterval(refresh, 500);
	onCleanup(() => clearInterval(timer));

	const activeProviderID = createMemo(() =>
		balancing() ? resolveActiveSelection(db)?.providerID : undefined,
	);

	const current = () => entries()[cursor()];

	const clampCursor = (value: number) =>
		Math.max(0, Math.min(value, Math.max(0, entries().length - 1)));
	const headerSelected = () => focusArea() === "header";
	const headerMarker = () =>
		prioritySelectionMarker({
			focusedArea: focusArea(),
			itemArea: "header",
			selected: true,
		});
	const rowMarker = (selected: boolean) =>
		prioritySelectionMarker({
			focusedArea: focusArea(),
			itemArea: "content",
			selected,
		});

	const toggleBalancing = () => {
		setBalancingEnabled(db, !balancing());
		refresh();
	};

	const toggleEnabled = (entry: PriorityEntry | undefined) => {
		if (!entry) return;
		setProviderEnabled(db, entry.providerID, !entry.enabled);
		refresh();
	};

	const reorder = (direction: -1 | 1) => {
		const entry = current();
		if (!entry) return;
		moveProvider(db, entry.providerID, direction);
		refresh();
		setCursor((value) => clampCursor(value + direction));
	};

	const handleKey = (event: KeyLike) => {
		const intent = reducePriorityKey({
			name: event.name ?? "",
			shift: event.shift,
		});
		switch (intent.type) {
			case "move-cursor":
				{
					const next = movePriorityFocus(
						{ area: focusArea(), cursor: cursor(), rowCount: entries().length },
						intent.delta,
					);
					setFocusArea(next.area);
					setCursor(clampCursor(next.cursor));
				}
				return;
			case "reorder":
				setFocusArea("content");
				reorder(intent.direction);
				return;
			case "toggle-enabled":
				if (focusArea() === "header") return;
				toggleEnabled(current());
				return;
			case "open-model": {
				if (focusArea() === "header") return props.onBack();
				const entry = current();
				if (entry) props.openModelPicker(entry.providerID, restoreFocus);
				return;
			}
			case "toggle-balancing":
				toggleBalancing();
				return;
			case "back":
				props.onBack();
				return;
			default:
				return;
		}
	};

	let container: { focus?: () => void } | undefined;
	const restoreFocus = () => queueMicrotask(() => container?.focus?.());
	onMount(() => container?.focus?.());

	const Hint = (hintProps: { children: string }) => (
		<text fg={theme().textMuted} truncate wrapMode="none">
			{hintProps.children}
		</text>
	);

	const Chip = (chipProps: {
		keyName: string;
		label: string;
		danger?: boolean;
	}) => (
		<text
			fg={chipProps.danger ? theme().warning : theme().accent}
			wrapMode="none"
		>
			[{chipProps.keyName}]{" "}
			<span style={{ fg: theme().textMuted }}>{chipProps.label}</span>
		</text>
	);

	const Row = (rowProps: {
		selected?: boolean;
		children: JSX.Element;
		onMouseUp?: () => void;
	}) => (
		<box
			backgroundColor={rowProps.selected ? selectedColors().bg : undefined}
			flexDirection="row"
			flexShrink={0}
			height={1}
			minWidth={0}
			onMouseUp={rowProps.onMouseUp}
			width="100%"
		>
			{rowProps.children}
		</box>
	);

	return (
		<box
			flexDirection="column"
			focusable
			gap={0}
			height="100%"
			onKeyDown={(event: KeyLike) => handleKey(event)}
			padding={1}
			ref={(ref: unknown) => (container = ref as { focus?: () => void })}
			width="100%"
		>
			<box flexDirection="column" gap={0} paddingBottom={1}>
				<text fg={theme().primary} overflow="hidden" truncate wrapMode="none">
					opencode-balancer{compact() ? "" : " priority matrix"}
				</text>
				<Show when={!compact()}>
					<Hint>
						Choose one model per provider and order failover priority.
					</Hint>
				</Show>
				<box
					backgroundColor={headerSelected() ? selectedColors().bg : undefined}
					flexShrink={0}
					height={1}
					onMouseUp={() => {
						setFocusArea("header");
						props.onBack();
					}}
				>
					<text
						fg={headerSelected() ? selectedColors().fg : theme().accent}
						overflow="hidden"
						truncate
						wrapMode="none"
					>
						{headerMarker()} [ back to dashboard ]
					</text>
				</box>
			</box>

			<box
				flexDirection="column"
				gap={0}
				onMouseUp={toggleBalancing}
				paddingBottom={1}
			>
				<text fg={theme().primary} overflow="hidden" truncate wrapMode="none">
					BALANCING {balancing() ? "ON" : "OFF"}
				</text>
				<Show when={!compact()}>
					<text
						fg={theme().textMuted}
						overflow="hidden"
						truncate
						wrapMode="none"
					>
						press B to toggle automatic provider failover
					</text>
				</Show>
			</box>

			<box flexDirection="column" gap={0} paddingBottom={1}>
				<Show when={!compact()}>
					<box flexDirection="row" gap={2}>
						<text fg={theme().primary} wrapMode="none">
							# PROVIDER
						</text>
						<text fg={theme().primary} wrapMode="none">
							MODEL
						</text>
						<text fg={theme().primary} wrapMode="none">
							ENABLED
						</text>
					</box>
				</Show>
				<Show
					fallback={
						<text fg={theme().textMuted} wrapMode="none">
							nenhum provider com conta ainda
						</text>
					}
					when={entries().length > 0}
				>
					<For each={entries()}>
						{(entry, index) => {
							const selected = () =>
								focusArea() === "content" && index() === cursor();
							const active = () => entry.providerID === activeProviderID();
							const rowColor = () => {
								if (!entry.enabled) return theme().textMuted;
								if (active()) return theme().success;
								return theme().text;
							};
							return (
								<Row
									onMouseUp={() => {
										setFocusArea("content");
										setCursor(index());
									}}
									selected={selected()}
								>
									<box
										backgroundColor={
											selected() ? selectedColors().bg : undefined
										}
										flexShrink={0}
										width={1}
									>
										<text
											fg={selected() ? selectedColors().fg : theme().accent}
											wrapMode="none"
										>
											{rowMarker(index() === cursor())}
										</text>
									</box>
									<box
										backgroundColor={
											selected() ? selectedColors().bg : undefined
										}
										flexShrink={0}
										width={3}
									>
										<text
											fg={selected() ? selectedColors().fg : rowColor()}
											wrapMode="none"
										>
											{index() + 1}.
										</text>
									</box>
									<box
										backgroundColor={
											selected() ? selectedColors().bg : undefined
										}
										flexShrink={0}
										width={18}
									>
										<text
											fg={selected() ? selectedColors().fg : rowColor()}
											overflow="hidden"
											truncate
											wrapMode="none"
										>
											{entry.providerID}
										</text>
									</box>
									<box
										backgroundColor={
											selected() ? selectedColors().bg : undefined
										}
										flexGrow={1}
										minWidth={0}
										onMouseUp={() =>
											props.openModelPicker(entry.providerID, restoreFocus)
										}
									>
										<text
											fg={
												selected()
													? selectedColors().fg
													: entry.modelID
														? rowColor()
														: theme().warning
											}
											overflow="hidden"
											truncate
											wrapMode="none"
										>
											{modelLabel(props.api, entry)}
										</text>
									</box>
									<box
										backgroundColor={
											selected() ? selectedColors().bg : undefined
										}
										flexShrink={0}
										onMouseUp={() => toggleEnabled(entry)}
										width={10}
									>
										<text
											fg={
												selected()
													? selectedColors().fg
													: entry.enabled
														? theme().success
														: theme().textMuted
											}
											overflow="hidden"
											truncate
											wrapMode="none"
										>
											{entry.enabled ? "enabled" : "disabled"}
										</text>
									</box>
								</Row>
							);
						}}
					</For>
				</Show>
			</box>

			<box flexDirection="column" gap={0}>
				<Show
					fallback={
						<Hint>
							↑↓ move · Shift+↑↓ reorder · Enter model · Space enable · Esc back
						</Hint>
					}
					when={!compact()}
				>
					<box flexDirection="row" gap={2}>
						<Chip keyName="↑↓" label="Move" />
						<Chip keyName="Shift+↑↓" label="Reorder" />
						<Chip keyName="Enter" label="Model" />
						<Chip keyName="Space" label="Enable" />
						<Chip keyName="Esc" label="Back" />
					</box>
					<Hint>
						{headerSelected()
							? "Enter returns to the dashboard."
							: "selected provider controls the next automatic failover target."}
					</Hint>
				</Show>
			</box>
		</box>
	);
}
