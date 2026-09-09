import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import { fireAction, fireItemAction, idToString, readSelection, toBig, writeSelection } from "../actions";

const object = (id: string): ObjectItem => ({ id } as unknown as ObjectItem);

function action(overrides: Partial<ActionValue> = {}): ActionValue & { execute: jest.Mock } {
    return { canExecute: true, isExecuting: false, execute: jest.fn(), ...overrides } as unknown as ActionValue & {
        execute: jest.Mock;
    };
}

describe("fireAction", () => {
    it("passes the variables on", () => {
        const a = action();
        fireAction(a, { itemId: "1" });
        expect(a.execute).toHaveBeenCalledWith({ itemId: "1" });
    });

    it("respects what the platform says about the action", () => {
        const cannot = action({ canExecute: false });
        const busy = action({ isExecuting: true });
        fireAction(cannot);
        fireAction(busy);
        fireAction(undefined);
        expect(cannot.execute).not.toHaveBeenCalled();
        expect(busy.execute).not.toHaveBeenCalled();
    });
});

describe("fireItemAction", () => {
    it("resolves the action for the row it belongs to", () => {
        const row = object("guid-1");
        const inner = action();
        const listAction = { get: jest.fn(() => inner) } as unknown as ListActionValue<any> & { get: jest.Mock };

        fireItemAction(listAction, row, { newStart: undefined });
        expect(listAction.get).toHaveBeenCalledWith(row);
        expect(inner.execute).toHaveBeenCalledWith({ newStart: undefined });
    });

    it("does nothing without an object to run it for", () => {
        const listAction = { get: jest.fn() } as unknown as ListActionValue<any> & { get: jest.Mock };
        fireItemAction(listAction, undefined);
        fireItemAction(undefined, object("guid-1"));
        expect(listAction.get).not.toHaveBeenCalled();
    });
});

describe("readSelection", () => {
    it("flattens both shapes of the Mendix selection", () => {
        const one = object("a");
        expect(readSelection({ type: "Single", selection: one } as any)).toEqual([one]);
        expect(readSelection({ type: "Single", selection: undefined } as any)).toEqual([]);
        expect(readSelection({ type: "Multi", selection: [one] } as any)).toEqual([one]);
        expect(readSelection(undefined)).toEqual([]);
    });
});

describe("writeSelection", () => {
    it("hands a multi selection the whole list", () => {
        const setSelection = jest.fn();
        const objects = [object("a"), object("b")];
        writeSelection({ type: "Multi", setSelection } as any, objects);
        expect(setSelection).toHaveBeenCalledWith(objects);
    });

    it("hands a single selection just the first object, or nothing", () => {
        const setSelection = jest.fn();
        writeSelection({ type: "Single", setSelection } as any, [object("a"), object("b")]);
        expect(setSelection).toHaveBeenCalledWith(object("a"));

        setSelection.mockClear();
        writeSelection({ type: "Single", setSelection } as any, []);
        expect(setSelection).toHaveBeenCalledWith(undefined);
    });

    it("survives Mendix refusing the objects", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        const setSelection = jest.fn(() => {
            throw new Error("object belongs to a different data source");
        });
        expect(() => writeSelection({ type: "Multi", setSelection } as any, [object("a")])).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("does nothing when the property is not configured", () => {
        expect(() => writeSelection(undefined, [object("a")])).not.toThrow();
    });
});

describe("idToString and toBig", () => {
    it("keeps an absent id absent rather than turning it into a string", () => {
        expect(idToString(7)).toBe("7");
        expect(idToString("7")).toBe("7");
        expect(idToString(null)).toBeUndefined();
        expect(idToString(undefined)).toBeUndefined();
    });

    it("converts only what an Integer action variable can carry", () => {
        expect(toBig(3)?.eq(new Big(3))).toBe(true);
        expect(toBig("3")?.eq(new Big(3))).toBe(true);
        expect(toBig(undefined)).toBeUndefined();
        expect(toBig({})).toBeUndefined();
        expect(toBig("not a number")).toBeUndefined();
    });
});
