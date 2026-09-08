import { Timeline, TimelineAnimationOptions } from "vis-timeline/standalone";
import { runCommand } from "../commands";

const animation: TimelineAnimationOptions = { animation: false };

type MockedTimeline = Timeline & Record<string, jest.Mock>;

function fakeTimeline(
    window = { start: new Date("2024-05-01T00:00:00Z"), end: new Date("2024-05-11T00:00:00Z") }
): MockedTimeline {
    return {
        fit: jest.fn(),
        redraw: jest.fn(),
        zoomIn: jest.fn(),
        zoomOut: jest.fn(),
        focus: jest.fn(),
        moveTo: jest.fn(),
        setWindow: jest.fn(),
        toggleRollingMode: jest.fn(),
        getWindow: jest.fn(() => window),
        getSelection: jest.fn(() => ["7"])
    } as unknown as MockedTimeline;
}

describe("runCommand", () => {
    it("is not case sensitive and tolerates padding", () => {
        const timeline = fakeTimeline();
        expect(runCommand(timeline, "  ZoomIn  ", animation, jest.fn())).toBe(true);
        expect(timeline.zoomIn).toHaveBeenCalledWith(0.5, animation);
    });

    it("delegates fit to the widget, which knows how to recover when vis-timeline refuses", () => {
        const timeline = fakeTimeline();
        const fit = jest.fn();
        runCommand(timeline, "fit", animation, fit);
        expect(fit).toHaveBeenCalledWith(animation);
        expect(timeline.fit).not.toHaveBeenCalled();
    });

    it("takes a percentage for zooming", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "zoomOut:0.2", animation, jest.fn());
        expect(timeline.zoomOut).toHaveBeenCalledWith(0.2, animation);
    });

    it("moves the window by a share of its own width", () => {
        const timeline = fakeTimeline();
        const tenDays = 10 * 24 * 60 * 60 * 1000;
        runCommand(timeline, "moveRight", animation, jest.fn());
        const [start, end] = (timeline.setWindow as jest.Mock).mock.calls[0];
        expect(start).toBe(new Date("2024-05-01T00:00:00Z").getTime() - tenDays * 0.2);
        expect(end).toBe(new Date("2024-05-11T00:00:00Z").getTime() - tenDays * 0.2);
    });

    it("focuses one or several items", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "focus:1, 2 ,3", animation, jest.fn());
        expect(timeline.focus).toHaveBeenCalledWith(["1", "2", "3"], animation);
    });

    it("focuses the current selection, and does nothing when there is none", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "focusSelection", animation, jest.fn());
        expect(timeline.focus).toHaveBeenCalledWith(["7"], animation);

        const empty = fakeTimeline();
        (empty.getSelection as jest.Mock).mockReturnValue([]);
        runCommand(empty, "focusSelection", animation, jest.fn());
        expect(empty.focus).not.toHaveBeenCalled();
    });

    it("sets both window bounds at once", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "setWindow:2024-01-01T00:00:00Z|2024-02-01T00:00:00Z", animation, jest.fn());
        expect(timeline.setWindow).toHaveBeenCalledWith(
            new Date("2024-01-01T00:00:00Z"),
            new Date("2024-02-01T00:00:00Z"),
            animation
        );
    });

    it("ignores a window or a moveTo it cannot read as a date", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "setWindow:not|adate", animation, jest.fn());
        runCommand(timeline, "moveTo:tomorrow", animation, jest.fn());
        expect(timeline.setWindow).not.toHaveBeenCalled();
        expect(timeline.moveTo).not.toHaveBeenCalled();
    });

    it("covers the remaining verbs", () => {
        const timeline = fakeTimeline();
        runCommand(timeline, "redraw", animation, jest.fn());
        runCommand(timeline, "toggleRollingMode", animation, jest.fn());
        runCommand(timeline, "moveLeft:0.5", animation, jest.fn());
        runCommand(timeline, "moveTo:2024-07-01T00:00:00Z", animation, jest.fn());

        const tenDays = 10 * 24 * 60 * 60 * 1000;
        expect(timeline.redraw).toHaveBeenCalled();
        expect(timeline.toggleRollingMode).toHaveBeenCalled();
        expect((timeline.setWindow as jest.Mock).mock.calls[0][0]).toBe(
            new Date("2024-05-01T00:00:00Z").getTime() + tenDays * 0.5
        );
        expect(timeline.moveTo).toHaveBeenCalledWith(new Date("2024-07-01T00:00:00Z"), animation);
    });

    it("reports an unknown command rather than acting on it", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        const timeline = fakeTimeline();
        expect(runCommand(timeline, "selfDestruct", animation, jest.fn())).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
