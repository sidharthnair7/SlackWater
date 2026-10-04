package ca.slackwater.analysis;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/**
 * Collects every point the engine followed in one measurement and writes them as compact JSON for the page's 3D
 * views. Six numbers a point: kind (0 water, 1 bank), pair, x and y in thousandths of the frame, vx and vy in tenths
 * of a source pixel per second. More than {@link #MAX_POINTS} are thinned to an even, repeatable sample.
 */
public final class PointCloud implements PointSink {

    public static final int MAX_POINTS = 15_000;

    private final List<double[]> points = new ArrayList<>();

    @Override
    public void water(int pair, double x, double y, double vx, double vy) {
        points.add(new double[]{0, pair, x, y, vx, vy});
    }

    @Override
    public void bank(int pair, double x, double y, double vx, double vy) {
        points.add(new double[]{1, pair, x, y, vx, vy});
    }

    public int size() {
        return points.size();
    }

    public String json(AnalysisResult result, Region region, String name, String label) {
        List<double[]> kept = points;
        if (points.size() > MAX_POINTS) {
            Random random = new Random(7);
            kept = new ArrayList<>(points.subList(0, MAX_POINTS));
            for (int i = MAX_POINTS; i < points.size(); i++) {
                int j = random.nextInt(i + 1);
                if (j < MAX_POINTS) {
                    kept.set(j, points.get(i));
                }
            }
        }
        GateValues g = result.gates();
        int width = g.width() == null ? 0 : g.width();
        double toSource = width <= VideoFrameSource.ANALYSIS_WIDTH ? 1 : (double) width / VideoFrameSource.ANALYSIS_WIDTH;
        StringBuilder json = new StringBuilder(kept.size() * 26 + 400);
        json.append("{\"name\":\"").append(escape(name)).append("\",\"label\":\"").append(escape(label)).append('"');
        json.append(",\"verdict\":\"").append(result.verdict()).append('"');
        json.append(",\"refusal\":").append(result.refusal() == null ? "null" : "\"" + result.refusal() + "\"");
        json.append(",\"width\":").append(width).append(",\"height\":").append(g.height() == null ? 0 : g.height());
        json.append(String.format(Locale.ROOT, ",\"region\":[%.4f,%.4f,%.4f,%.4f]",
                region.x(), region.y(), region.width(), region.height()));
        json.append(",\"pairs\":").append(g.pairsTotal() == null ? 0 : g.pairsTotal());
        json.append(",\"followed\":").append(points.size());
        json.append(number(",\"speedPxPerSec\":", result.surfaceSpeedPxPerSec()));
        json.append(number(",\"speedMetresPerSec\":", result.surfaceSpeedMetresPerSec()));
        json.append(number(",\"thresholdPxPerSec\":", g.movingThresholdPxPerSec()));
        json.append(number(",\"noisePxPerSec\":", g.noiseFloorPxPerSec()));
        json.append(number(",\"bankLimitPxPerSec\":", FlowAnalyzer.MAX_NOISE_PX_PER_SEC * toSource));
        json.append(",\"points\":[");
        for (int i = 0; i < kept.size(); i++) {
            double[] p = kept.get(i);
            if (i > 0) {
                json.append(',');
            }
            json.append((int) p[0]).append(',').append((int) p[1]).append(',')
                    .append(Math.round(p[2] * 1000)).append(',').append(Math.round(p[3] * 1000)).append(',')
                    .append(Math.round(p[4] * 10)).append(',').append(Math.round(p[5] * 10));
        }
        return json.append("]}\n").toString();
    }

    private static String number(String key, Double value) {
        return key + (value == null ? "null" : String.format(Locale.ROOT, "%.3f", value));
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replaceAll("[\\x00-\\x1f]", " ");
    }
}
