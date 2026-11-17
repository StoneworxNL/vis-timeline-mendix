import { VisId } from "../values";
import { createLocalEditSettler } from "../localEdits";

describe("createLocalEditSettler", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function setup(running = false): {
        edits: Set<VisId>;
        settle: jest.Mock;
        state: { running: boolean };
        settler: ReturnType<typeof createLocalEditSettler>;
    } {
        const edits = new Set<VisId>();
        const state = { running };
        const settle = jest.fn(() => edits.clear());
        const settler = createLocalEditSettler(edits, () => state.running, settle, 1000);
        return { edits, settle, state, settler };
    }

    // Regression (review of c3d2914): the wait only started when an action's busy state flipped.
    // A move or remove whose action never runs (canExecute false) or a nanoflow that refuses
    // before Mendix shows it as busy stayed on screen.
    it("puts a move back when its action never runs", () => {
        const { edits, settle, settler } = setup();
        settler.mark("item-1");
        expect(edits.has("item-1")).toBe(true);
        jest.advanceTimersByTime(999);
        expect(settle).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(settle).toHaveBeenCalledTimes(1);
    });

    it("puts a remove back when its action never runs", () => {
        const { settle, settler } = setup();
        settler.mark(7);
        jest.advanceTimersByTime(1000);
        expect(settle).toHaveBeenCalledTimes(1);
    });

    it("waits for an action that does run, then settles once it is done", () => {
        const { settle, state, settler } = setup();
        settler.mark("item-1");
        state.running = true;
        settler.actionsChanged(true);
        jest.advanceTimersByTime(5000);
        expect(settle).not.toHaveBeenCalled();

        state.running = false;
        settler.actionsChanged(false);
        jest.advanceTimersByTime(999);
        expect(settle).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(settle).toHaveBeenCalledTimes(1);
    });

    it("does not settle while an action is still busy when the wait runs out", () => {
        const { settle, state, settler } = setup();
        settler.mark("item-1");
        state.running = true;
        jest.advanceTimersByTime(1000);
        expect(settle).not.toHaveBeenCalled();
    });

    it("restarts the wait on every new edit", () => {
        const { settle, settler } = setup();
        settler.mark("a");
        jest.advanceTimersByTime(600);
        settler.mark("b");
        jest.advanceTimersByTime(600);
        expect(settle).not.toHaveBeenCalled();
        jest.advanceTimersByTime(400);
        expect(settle).toHaveBeenCalledTimes(1);
    });

    it("does nothing without edits, or for an edit without an id", () => {
        const { edits, settle, settler } = setup();
        settler.actionsChanged(false);
        settler.mark(undefined);
        settler.mark(null);
        jest.advanceTimersByTime(5000);
        expect(edits.size).toBe(0);
        expect(settle).not.toHaveBeenCalled();
    });

    it("stops waiting when cancelled or disposed", () => {
        const { settle, settler } = setup();
        settler.mark("a");
        settler.cancel();
        jest.advanceTimersByTime(1000);
        settler.mark("b");
        settler.dispose();
        settler.mark("c");
        settler.actionsChanged(false);
        jest.advanceTimersByTime(5000);
        expect(settle).not.toHaveBeenCalled();
    });
});
