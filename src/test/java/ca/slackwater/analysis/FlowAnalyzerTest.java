package ca.slackwater.analysis;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class FlowAnalyzerTest {

    private final FlowAnalyzer analyzer = new FlowAnalyzer();

    private AnalysisResult run(SyntheticClip clip, Region region, Double metresPerPixel) throws Exception {
        try (clip) {
            return analyzer.analyze(clip, new AnalysisSettings(region, metresPerPixel));
        }
    }

    private AnalysisResult run(SyntheticClip clip) throws Exception {
        return run(clip, SyntheticClip.WATER, null);
    }

    /** Angles wrap around: 359.9 degrees is 0.1 away from 0, not 359.9. */
    private static double angleBetween(double a, double b) {
        double difference = Math.abs(a - b) % 360;
        return Math.min(difference, 360 - difference);
    }

    @Test
    void movingWaterIsMeasuredAtItsTrueSpeed() throws Exception {
        // 2 px per frame at 30 frames per second is exactly 60 px per second, to the right.
        AnalysisResult result = run(SyntheticClip.flowing(2, 0));

        assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
        assertThat(result.surfaceSpeedPxPerSec()).isCloseTo(60, within(1.2));
        assertThat(angleBetween(result.directionDegrees(), 0)).isLessThan(3.0);
        assertThat(result.surfaceSpeedMetresPerSec()).isNull();
    }

    @Test
    void slowWaterIsStillMeasured() throws Exception {
        // 0.5 px per frame = 15 px per second, a slow trickle.
        AnalysisResult result = run(SyntheticClip.flowing(0.5, 0));

        assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
        assertThat(result.surfaceSpeedPxPerSec()).isCloseTo(15, within(0.75));
    }

    @Test
    void scaleTurnsPixelsIntoMetres() throws Exception {
        AnalysisResult result = run(SyntheticClip.flowing(2, 0), SyntheticClip.WATER, 0.01);

        assertThat(result.surfaceSpeedMetresPerSec()).isCloseTo(0.6, within(0.012));
    }

    @Test
    void directionFollowsTheWater() throws Exception {
        // Moving down the frame is 270 degrees.
        AnalysisResult result = run(SyntheticClip.flowing(0, 1.5));

        assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
        assertThat(angleBetween(result.directionDegrees(), 270)).isLessThan(3.0);
    }

    @Test
    void stillWaterIsCalledStill() throws Exception {
        AnalysisResult result = run(SyntheticClip.still());

        assertThat(result.verdict()).isEqualTo(Verdict.STILL);
        assertThat(result.gates().movingShare()).isLessThan(0.05);
    }

    @Test
    void shakyCameraIsRefused() throws Exception {
        AnalysisResult result = run(SyntheticClip.shakyCamera());

        assertThat(result.verdict()).isEqualTo(Verdict.REFUSED);
        assertThat(result.refusal()).isEqualTo(Refusal.CAMERA_MOVED);
    }

    @Test
    void featurelessWaterIsRefusedNotGuessed() throws Exception {
        AnalysisResult result = run(SyntheticClip.flatWater());

        assertThat(result.refusal()).isEqualTo(Refusal.NOTHING_TO_TRACK);
    }

    @Test
    void mixedDirectionsAreRefused() throws Exception {
        AnalysisResult result = run(SyntheticClip.mixedDirections());

        assertThat(result.refusal()).isEqualTo(Refusal.MIXED_DIRECTIONS);
    }

    @Test
    void tooShortIsRefused() throws Exception {
        AnalysisResult result = run(SyntheticClip.tooShort());

        assertThat(result.refusal()).isEqualTo(Refusal.TOO_SHORT);
    }

    @Test
    void waterLeftOutsideTheBoxIsRefusedNotCalledStill() throws Exception {
        // The box covers only the left half of the flowing strip, so moving water sits in the "background".
        // Before engine 0.2.0 this inflated the noise floor and the real top-down Geul clip came out STILL.
        AnalysisResult result = run(SyntheticClip.flowing(2, 0), new Region(0, 1.0 / 3, 0.5, 1.0 / 3), null);

        assertThat(result.refusal()).isEqualTo(Refusal.BACKGROUND_MOVING);
    }

    @Test
    void noBackgroundMeansTheCameraCannotBeChecked() throws Exception {
        AnalysisResult result = run(SyntheticClip.flowing(2, 0), new Region(0, 0, 1, 1), null);

        assertThat(result.refusal()).isEqualTo(Refusal.NO_FIXED_BACKGROUND);
    }
}
