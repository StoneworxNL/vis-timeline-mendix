import { Big } from "big.js";
import { DynamicValue, ListAttributeValue, ListExpressionValue, ObjectItem } from "mendix";

/**
 * vis-timeline identifiers.
 *
 * Everything is normalised to a string so that items, groups, subgroups and markers keep matching
 * each other regardless of the Mendix attribute type behind them (String, Integer, Long,
 * AutoNumber or Decimal). Mixing a numeric group id with a string item group id is the single most
 * common reason for items to silently disappear from a timeline.
 */
export type VisId = string;

export function toVisId(value: string | Big | undefined): VisId | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const id = typeof value === "string" ? value : value.toString();
    return id.length > 0 ? id : undefined;
}

/** Reads an attribute of a data source row. Uses `value`, never `displayValue`, so numbers do not
 *  arrive formatted with thousand separators. */
export function readAttribute<T extends string | boolean | Date | Big>(
    attribute: ListAttributeValue<T> | undefined,
    item: ObjectItem
): T | undefined {
    return attribute?.get(item).value;
}

export function readId(attribute: ListAttributeValue<string | Big> | undefined, item: ObjectItem): VisId | undefined {
    return toVisId(attribute?.get(item).value);
}

export function readNumber(attribute: ListAttributeValue<Big> | undefined, item: ObjectItem): number | undefined {
    const value = attribute?.get(item).value;
    return value === undefined ? undefined : Number(value.toString());
}

export function readTemplate(template: ListExpressionValue<string> | undefined, item: ObjectItem): string | undefined {
    const value = template?.get(item).value;
    return value !== undefined && value !== "" ? value : undefined;
}

export function dynamicValue<T>(value: DynamicValue<T> | undefined): T | undefined {
    return value?.status === "available" ? value.value : undefined;
}

export function dynamicBoolean(value: DynamicValue<boolean> | undefined, fallback = false): boolean {
    return dynamicValue(value) ?? fallback;
}

export function dynamicNumber(value: DynamicValue<Big> | undefined): number | undefined {
    const big = dynamicValue(value);
    return big === undefined ? undefined : Number(big.toString());
}

export function dynamicText(value: DynamicValue<string> | undefined): string | undefined {
    const text = dynamicValue(value);
    return text !== undefined && text !== "" ? text : undefined;
}

/** Parses a JSON object typed into a Studio Pro expression. Returns undefined for anything that is
 *  not a plain object, so a typo can never take the whole timeline down. */
export function parseJsonObject(raw: string | undefined, propertyName: string): Record<string, unknown> | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        console.warn(`VisTimeline: ${propertyName} must be a JSON object, received ${typeof parsed}.`);
    } catch (error) {
        console.warn(`VisTimeline: could not parse ${propertyName} as JSON.`, error);
    }
    return undefined;
}

/** Recursively merges `source` into `target`, so the JSON escape hatch can override a single
 *  nested option (for example `tooltip.delay`) without dropping its siblings. */
export function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, unknown>): T {
    for (const [key, value] of Object.entries(source)) {
        const current = target[key];
        if (isPlainObject(value) && isPlainObject(current)) {
            deepMerge(current, value);
        } else {
            (target as Record<string, unknown>)[key] = value;
        }
    }
    return target;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function splitIds(raw: string | undefined): VisId[] {
    if (!raw) {
        return [];
    }
    return raw
        .split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

export function sameIds(a: readonly VisId[], b: readonly VisId[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function toDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value === "number" || typeof value === "string") {
        const date = new Date(value);
        return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
}
