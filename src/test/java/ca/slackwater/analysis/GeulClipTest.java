package ca.slackwater.analysis;

import org.junit.jupiter.api.Test;

import java.io.File;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * Real river footage: the Geul at Hommerich (NL) during a high-flow event, Zenodo record 15002591, CC BY 4.0.
 * There are no independent reference velocities for this clip, so these tests pin the engine's own answers
 * (a regression check), not its accuracy.
 */
class GeulClipTest {

    private static final File ORIGINAL = new File("clips/geul/20241010_081717.mp4");
    private static final File TOP_DOWN = new File("clips/geul/20241010_081717_ortho.mp4");

    private AnalysisResult run(File clip, Region region, Double metresPerPixel) throws Exception {
        try (VideoFrameSource source = new VideoFrameSource(clip)) {
            return new FlowAnalyzer().analyze(source, new AnalysisSettings(region, metresPerPixel));
        }
    }

    @Test
    void topDownClipBankToBankIsMovingAtAboutOnePointSixMetresPerSecond() throws Exception {
        AnalysisResult result = run(TOP_DOWN, new Region(0.0, 0.14, 1.0, 0.74), 0.01);

        assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
        assertThat(result.surfaceSpeedMetresPerSec()).isCloseTo(1.59, within(0.1));
        assertThat(result.gates().directionCoherence()).isGreaterThan(0.9);
    }

    @Test
    void originalCameraViewIsMoving() throws Exception {
        AnalysisResult result = run(ORIGINAL, new Region(0.05, 0.30, 0.68, 0.55), null);

        assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
        assertThat(result.gates().cameraUnstableShare()).isZero();
    }

    @Test
    void aBoxThatLeavesWaterOutsideIsRefused() throws Exception {
        // The mistake that made engine 0.1.0 call this flood STILL.
        AnalysisResult result = run(TOP_DOWN, new Region(0.30, 0.20, 0.68, 0.65), 0.01);

        assertThat(result.refusal()).isEqualTo(Refusal.BACKGROUND_MOVING);
    }

    @Test
    void everyVerdictComesWithAnEvidencePicture() throws Exception {
        AnalysisResult result = run(TOP_DOWN, new Region(0.0, 0.14, 1.0, 0.74), 0.01);

        byte[] png = result.evidencePng();
        assertThat(png).isNotNull();
        assertThat(png).startsWith((byte) 0x89, (byte) 'P', (byte) 'N', (byte) 'G');
        assertThat(result.overlayPng()).startsWith((byte) 0x89, (byte) 'P', (byte) 'N', (byte) 'G');
    }
}
