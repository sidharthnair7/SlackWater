package ca.slackwater.reading;

import ca.slackwater.analysis.AnalysisResult;

/** Builds a Reading for tests outside this package (Reading.of is package-private). */
public final class ReadingFixtures {

    private ReadingFixtures() {
    }

    public static Reading reading(AnalysisResult result, String siteName, String videoSha256) {
        return Reading.of(result, new Site(siteName, null, null), "clip.mp4", null, videoSha256,
                "region=0.0000,0.1400,1.0000,0.7400;mpp=0.010000;max=15.0", "0.2.0");
    }
}
