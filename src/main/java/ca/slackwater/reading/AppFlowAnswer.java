package ca.slackwater.reading;

import ca.slackwater.analysis.Verdict;

/**
 * A reading in the OneAquaHealth citizen app's own words. The app asks people to judge the water flow by eye
 * and offers four answers (from its public API, checked Oct 2): FAS "Fast (with waves or high velocity)",
 * NOR "Slow", STA "Stagnant/intermittent", DRY "Dry". This puts our measurement next to that answer.
 *
 * @param code  the app's code, or null when the reading can't choose one
 * @param label the app's wording
 * @param why   how we got there, in plain words
 */
public record AppFlowAnswer(String code, String label, String why) {

    /**
     * Where Slow ends and Fast begins, in metres per second of surface speed. There is no standard for this:
     * it is our assumption, stated wherever it's used, and the first thing to check against citizens' answers.
     */
    public static final double FAST_FROM_METRES_PER_SEC = 0.5;

    public static AppFlowAnswer of(Verdict verdict, Double metresPerSec) {
        if (verdict == Verdict.STILL) {
            return new AppFlowAnswer("STA", "Stagnant/intermittent",
                    "Things on the surface were visible and stayed put.");
        }
        if (verdict == Verdict.MOVING && metresPerSec != null) {
            boolean fast = metresPerSec >= FAST_FROM_METRES_PER_SEC;
            return new AppFlowAnswer(fast ? "FAS" : "NOR",
                    fast ? "Fast (with waves or high velocity)" : "Slow",
                    String.format(java.util.Locale.ROOT, "Surface speed %.2f m/s, %s our assumed cut-off of %.1f m/s.",
                            metresPerSec, fast ? "at or above" : "below", FAST_FROM_METRES_PER_SEC));
        }
        if (verdict == Verdict.MOVING) {
            return new AppFlowAnswer(null, null,
                    "Moving, but without a scale we can't tell Slow from Fast.");
        }
        return new AppFlowAnswer(null, null, "Refused, so there's no answer to give. Dry can't be seen from video.");
    }
}
