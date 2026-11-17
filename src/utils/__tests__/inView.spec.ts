import { Timeline } from "vis-timeline/standalone";
import { createInViewReporter } from "../inView";

function fakeTimeline(items: string[] = ["1", "2"], groups: string[] = ["g"]): Timeline & Record<string, jest.Mock> {
    return {
        getVisibleItems: jest.fn(() => items),
        getVisibleGroups: jest.fn(() => groups)
    } as unknown as Timeline & Record<string, jest.Mock>;
}

describe("createInViewReporter", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("reports what is in view once the timeline has settled", () => {
        const timeline = fakeTimeline();
        const onChange = jest.fn();
        const reporter = createInViewReporter(timeline, onChange, () => true);

        reporter.report();
        reporter.report();
        jest.advanceTimersByTime(250);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("1,2", "g");
    });

    it("only reports a change", () => {
        const onChange = jest.fn();
        const reporter = createInViewReporter(fakeTimeline(), onChange, () => true);
        reporter.report();
        jest.advanceTimersByTime(250);
        reporter.report();
        jest.advanceTimersByTime(250);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Regression: the pending report outlived the timeline, asked the destroyed instance and ran
    // the action after the user had left the page.
    it("never touches the timeline or the action once disposed", () => {
        const timeline = fakeTimeline();
        const onChange = jest.fn();
        const reporter = createInViewReporter(timeline, onChange, () => true);

        reporter.report();
        reporter.dispose();
        jest.advanceTimersByTime(1000);
        reporter.report();
        jest.advanceTimersByTime(1000);

        expect(timeline.getVisibleItems).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("does not ask the timeline when nobody listens", () => {
        const timeline = fakeTimeline();
        const reporter = createInViewReporter(timeline, jest.fn(), () => false);
        reporter.report();
        jest.advanceTimersByTime(250);
        expect(timeline.getVisibleItems).not.toHaveBeenCalled();
    });
});
