import { CSSProperties, ReactElement, ReactNode } from "react";
import { VisTimelinePreviewProps } from "../typings/VisTimelineProps";

const MOCK_ITEMS: Array<{ left: string; width: string; label: string }> = [
    { left: "4%", width: "26%", label: "Item" },
    { left: "38%", width: "18%", label: "Item" },
    { left: "62%", width: "30%", label: "Item" }
];

/**
 * Studio Pro cannot run vis-timeline, so design mode shows a static impression of the timeline.
 * The custom content properties are rendered through their own renderer, which is what turns them
 * into drop zones on the page.
 */
export function preview(values: VisTimelinePreviewProps): ReactElement {
    const ItemContent = values.itemContentWidgets?.renderer;
    const GroupContent = values.groupContentWidgets?.renderer;
    const customItems = values.itemContentType === "custom" && ItemContent;
    const customGroups = values.groupContentType === "custom" && GroupContent;

    return (
        <div style={styles.root} className={values.class}>
            <div style={styles.axis}>
                {["Mon", "Tue", "Wed", "Thu"].map(label => (
                    <span key={label} style={styles.axisLabel}>
                        {label}
                    </span>
                ))}
            </div>
            {[0, 1].map(row => (
                <div key={row} style={styles.row}>
                    <div style={styles.groupLabel}>
                        {customGroups && GroupContent ? (
                            <GroupContent caption="Group content">{null as ReactNode}</GroupContent>
                        ) : (
                            `Group ${row + 1}`
                        )}
                    </div>
                    <div style={styles.lane}>
                        {MOCK_ITEMS.slice(row).map((item, index) => (
                            <div key={index} style={{ ...styles.item, left: item.left, width: item.width }}>
                                {customItems && ItemContent ? (
                                    <ItemContent caption="Item content">{null as ReactNode}</ItemContent>
                                ) : (
                                    item.label
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function getPreviewCss(): string {
    return require("./ui/VisTimeline.css");
}

const styles: Record<string, CSSProperties> = {
    root: {
        border: "1px solid #ccc",
        borderRadius: 2,
        background: "#fff",
        font: "12px sans-serif",
        color: "#4d4d4d",
        minHeight: 120
    },
    axis: {
        display: "flex",
        justifyContent: "space-around",
        borderBottom: "1px solid #ccc",
        padding: "4px 0",
        background: "#f5f5f5"
    },
    axisLabel: { flex: 1, textAlign: "center" },
    row: { display: "flex", borderBottom: "1px solid #eee", minHeight: 40 },
    groupLabel: {
        width: 120,
        flex: "0 0 120px",
        borderRight: "1px solid #ccc",
        padding: 8,
        background: "#fafafa"
    },
    lane: { position: "relative", flex: 1, padding: "8px 0" },
    item: {
        position: "absolute",
        top: 8,
        padding: "2px 6px",
        border: "1px solid #97b0f8",
        borderRadius: 2,
        background: "#d5ddf6",
        color: "#1f2d3d",
        boxSizing: "border-box",
        overflow: "hidden",
        whiteSpace: "nowrap"
    }
};
