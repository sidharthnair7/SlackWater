package ca.slackwater.analysis;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Scores the engine against clips a person labelled first (clips/labels.csv), and writes the result to
 * clips/score.md for the README and Devpost. Skipped until the labels exist.
 *
 * <pre>
 * file,label,regionX,regionY,regionWidth,regionHeight,why
 * commons/pond_duckweed.webm,still,0.1,0.4,0.8,0.5,duckweed doesn't move
 * </pre>
 * label is still, moving, or cant-tell. Run with: ./mvnw test -Dtest=LabelledClipsScoreTest
 *
 * A refusal is not counted as wrong: it's its own column, because refusing is the tool doing its job when a
 * clip can't prove anything. A clip the labeller couldn't call either is reported separately.
 */
class LabelledClipsScoreTest {

    enum Outcome { RIGHT, WRONG, REFUSED, ANSWERED_UNCLEAR }

    record Row(String file, String label, AnalysisResult result, Outcome outcome) {
    }

    @Test
    void scoreTheLabelledClips() throws Exception {
        Path labels = Path.of(System.getProperty("slackwater.labels", "clips/labels.csv"));
        Assumptions.assumeTrue(Files.exists(labels), "No labels yet at " + labels.toAbsolutePath());
        Path clipsDir = labels.toAbsolutePath().getParent();

        List<Row> rows = new ArrayList<>();
        for (String line : Files.readAllLines(labels, StandardCharsets.UTF_8)) {
            if (line.isBlank() || line.startsWith("#") || line.startsWith("file,")) {
                continue;
            }
            String[] c = line.split(",", 7);
            String label = normalise(c[1]);
            Region region = new Region(Double.parseDouble(c[2]), Double.parseDouble(c[3]),
                    Double.parseDouble(c[4]), Double.parseDouble(c[5]));
            AnalysisResult result;
            try (VideoFrameSource source = new VideoFrameSource(clipsDir.resolve(c[0].trim()).toFile())) {
                result = new FlowAnalyzer().analyze(source, new AnalysisSettings(region, null));
            } catch (Exception e) {
                result = AnalysisResult.refused(Refusal.VIDEO_UNREADABLE, GateValues.none());
            }
            rows.add(new Row(c[0].trim(), label, result, outcome(label, result.verdict())));
        }
        assertThat(rows).as("labels.csv has no clips").isNotEmpty();

        String report = report(rows);
        System.out.println(report);
        Files.writeString(clipsDir.resolve("score.md"), report, StandardCharsets.UTF_8);
    }

    static String normalise(String label) {
        String l = label.trim().toLowerCase(Locale.ROOT).replace("'", "").replace(" ", "-");
        return switch (l) {
            case "still", "stagnant" -> "still";
            case "moving", "flowing" -> "moving";
            default -> "cant-tell";
        };
    }

    static Outcome outcome(String label, Verdict verdict) {
        if (verdict == Verdict.REFUSED) {
            return Outcome.REFUSED;
        }
        if (label.equals("cant-tell")) {
            return Outcome.ANSWERED_UNCLEAR;
        }
        boolean right = (label.equals("still") && verdict == Verdict.STILL)
                || (label.equals("moving") && verdict == Verdict.MOVING);
        return right ? Outcome.RIGHT : Outcome.WRONG;
    }

    static String report(List<Row> rows) {
        long right = rows.stream().filter(r -> r.outcome() == Outcome.RIGHT).count();
        long wrong = rows.stream().filter(r -> r.outcome() == Outcome.WRONG).count();
        long refused = rows.stream().filter(r -> r.outcome() == Outcome.REFUSED).count();
        long refusedUnclear = rows.stream()
                .filter(r -> r.outcome() == Outcome.REFUSED && r.label().equals("cant-tell")).count();
        long answeredUnclear = rows.stream().filter(r -> r.outcome() == Outcome.ANSWERED_UNCLEAR).count();

        StringBuilder md = new StringBuilder();
        md.append("# SlackWater score on labelled clips\n\n");
        md.append(String.format(Locale.ROOT, "Engine %s, %d clips, labelled by a person before the engine saw them.%n%n",
                FlowAnalyzer.ENGINE_VERSION, rows.size()));
        md.append(String.format(Locale.ROOT,
                "**Right %d · Wrong %d · Refused %d** (including %d the labeller couldn't call either)",
                right, wrong, refused, refusedUnclear));
        if (answeredUnclear > 0) {
            md.append(String.format(Locale.ROOT, " · answered %d clips the labeller couldn't call", answeredUnclear));
        }
        md.append("\n\n| Clip | Label | Engine | Outcome | Why |\n|---|---|---|---|---|\n");
        for (Row r : rows) {
            String engine = r.result().verdict() == Verdict.REFUSED
                    ? "REFUSED " + r.result().refusal()
                    : r.result().verdict() + (r.result().surfaceSpeedPxPerSec() == null ? ""
                    : String.format(Locale.ROOT, " %.0f px/s", r.result().surfaceSpeedPxPerSec()));
            md.append("| ").append(r.file()).append(" | ").append(r.label()).append(" | ").append(engine)
                    .append(" | ").append(r.outcome().name().toLowerCase(Locale.ROOT).replace('_', ' '))
                    .append(" | ").append(r.result().reason().replace("|", "/")).append(" |\n");
        }
        return md.toString();
    }
}
