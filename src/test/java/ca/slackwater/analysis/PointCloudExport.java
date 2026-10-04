package ca.slackwater.analysis;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

/**
 * Writes every point the engine followed in the three Geul readings to {@code frontend/public/points/}, so the
 * landing page's 3D section works even with no engine behind it. Not part of the normal test run (the class name
 * doesn't end in Test); run it with {@code ./mvnw test -Dtest=PointCloudExport -Dskip.npm -Dskip.installnodenpm}
 * after the engine changes.
 */
class PointCloudExport {

    private static final File ORIGINAL = new File("clips/geul/20241010_081717.mp4");
    private static final File TOP_DOWN = new File("clips/geul/20241010_081717_ortho.mp4");

    @Test
    void export() throws Exception {
        // The same clips and boxes as clips/seed.csv, so these are the points behind the readings on the site.
        write("geul-camera", "Camera view", ORIGINAL, new Region(0.05, 0.30, 0.68, 0.55), null);
        write("geul-topdown", "Top-down, 0.01 m/px", TOP_DOWN, new Region(0.0, 0.14, 1.0, 0.74), 0.01);
        write("geul-small-box", "Box drawn too small", TOP_DOWN, new Region(0.30, 0.20, 0.68, 0.65), 0.01);
    }

    private void write(String name, String label, File clip, Region region, Double metresPerPixel) throws Exception {
        PointCloud cloud = new PointCloud();
        AnalysisResult result;
        try (VideoFrameSource source = new VideoFrameSource(clip)) {
            result = new FlowAnalyzer().analyze(source, new AnalysisSettings(region, metresPerPixel), cloud);
        }
        Path out = Path.of("frontend/public/points/" + name + ".json");
        Files.createDirectories(out.getParent());
        Files.writeString(out, cloud.json(result, region, name, label), StandardCharsets.UTF_8);
        System.out.printf(Locale.ROOT, "%s: %s %s, %d points followed%n", name, result.verdict(), result.refusal(), cloud.size());
    }
}
