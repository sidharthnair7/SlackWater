package ca.slackwater.analysis;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class VideoFrameSourceTest {

    @TempDir
    Path dir;

    @Test
    void aRealVideoFileGivesTheSameAnswerAsTheFramesInside() throws Exception {
        Path video = ClipFiles.writeFlowingClip(dir);

        try (VideoFrameSource source = new VideoFrameSource(video.toFile())) {
            assertThat(source.frameRate()).isCloseTo(30, within(0.01));
            AnalysisResult result = new FlowAnalyzer().analyze(source, new AnalysisSettings(SyntheticClip.WATER, null));

            assertThat(result.verdict()).isEqualTo(Verdict.MOVING);
            // Within 2%, through a real encode, container and decode.
            assertThat(result.surfaceSpeedPxPerSec()).isCloseTo(60, within(1.2));
        }
    }
}
