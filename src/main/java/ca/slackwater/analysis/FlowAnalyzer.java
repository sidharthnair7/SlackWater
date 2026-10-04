package ca.slackwater.analysis;

import org.bytedeco.javacpp.indexer.FloatIndexer;
import org.bytedeco.javacpp.indexer.UByteIndexer;
import org.bytedeco.opencv.opencv_core.Mat;
import org.bytedeco.opencv.opencv_core.Rect;
import org.bytedeco.opencv.opencv_core.Scalar;
import org.bytedeco.opencv.opencv_core.Size;
import org.bytedeco.opencv.opencv_core.TermCriteria;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

import static org.bytedeco.opencv.global.opencv_core.CV_8UC1;
import static org.bytedeco.opencv.global.opencv_imgproc.goodFeaturesToTrack;
import static org.bytedeco.opencv.global.opencv_imgproc.rectangle;
import static org.bytedeco.opencv.global.opencv_video.calcOpticalFlowPyrLK;

/**
 * Decides whether the water in a clip is still or moving, or refuses and says why.
 *
 * <p>The pipeline: pick frame pairs about 0.1 s apart, find corner-like points inside the water box and
 * outside it, follow each point to the next frame (Lucas-Kanade optical flow), and keep only points that
 * also track back to where they started. The background points tell us whether the camera moved; the
 * water points, with the camera's shift taken out, tell us whether the surface moved.
 */
public class FlowAnalyzer {

    public static final String ENGINE_VERSION = "0.2.0";

    // Every threshold below is our assumption, not a published standard. They are fixed per
    // ENGINE_VERSION, and the version goes into every fingerprint, so a reading can always be traced
    // back to the exact rules that made it.

    /** Track between frames about this far apart, so slow water moves enough pixels to measure. */
    static final double PAIR_SECONDS = 0.1;
    static final int MAX_WATER_CORNERS = 300;
    static final int MAX_BACKGROUND_CORNERS = 200;
    static final double CORNER_QUALITY = 0.01;
    static final double CORNER_MIN_DISTANCE = 6;
    static final int CORNER_BLOCK_SIZE = 7;
    /** Keep points this far from the water box edge, so the bank never leaks into the water and back. */
    static final int EDGE_MARGIN_PX = 8;
    /** A point tracked forward and then back must land within this distance of where it started. */
    static final double MAX_ROUND_TRIP_ERROR_PX = 0.5;

    static final double MIN_SECONDS = 1.0;
    static final int MIN_PAIRS = 5;
    static final double MIN_BACKGROUND_TRACKS = 12;
    /** Background shift per pair, in analysis pixels, above which we say the camera moved. */
    static final double CAMERA_SHIFT_PX = 0.8;
    static final double MAX_UNSTABLE_SHARE = 0.25;
    /**
     * The background's own jitter must stay below this (analysis px/s, so 1.5 px per pair). Added in 0.2.0
     * after the top-down Geul clip: water left outside the box counted as "background", the noise floor rose
     * to 64 px/s, and real flow was called STILL. Steady real clips measured 1 to 3 px/s.
     */
    static final double MAX_NOISE_PX_PER_SEC = 15.0;
    static final double MIN_WATER_TRACKS = 15;
    /** Floor for "moving": 0.3 px per 0.1 s at 640 px wide, about the limit of tracking precision. */
    static final double MIN_MOVING_PX_PER_SEC = 3.0;
    static final double NOISE_MULTIPLIER = 3.0;
    static final double MIN_MOVING_SHARE = 0.25;
    /** 1.0 = every moving point goes the same way, 0 = no common direction at all. */
    static final double MIN_COHERENCE = 0.6;

    private static final Size LK_WINDOW = new Size(21, 21);
    private static final int LK_PYRAMID_LEVELS = 3;
    private static final TermCriteria LK_STOP =
            new TermCriteria(TermCriteria.COUNT + TermCriteria.EPS, 30, 0.01);

    public AnalysisResult analyze(FrameSource source, AnalysisSettings settings) throws Exception {
        return analyze(source, settings, PointSink.NONE);
    }

    /** The same measurement, also handing every followed point to {@code points}. The result doesn't change. */
    public AnalysisResult analyze(FrameSource source, AnalysisSettings settings, PointSink points) throws Exception {
        try (Evidence evidence = new Evidence()) {
            AnalysisResult result = measure(source, settings, evidence, points);
            Double threshold = result.gates().movingThresholdPxPerSec() == null || result.gates().width() == null
                    ? null
                    : result.gates().movingThresholdPxPerSec() * evidenceScale(result);
            return result.withEvidence(evidence.render(settings.region(), threshold, result),
                    evidence.renderOverlay(settings.region(), threshold, result));
        }
    }

    /** Converts the gate values' source pixels back to the analysis pixels the evidence frame is drawn in. */
    private static double evidenceScale(AnalysisResult result) {
        int sourceWidth = result.gates().width();
        return sourceWidth <= VideoFrameSource.ANALYSIS_WIDTH ? 1.0 : (double) VideoFrameSource.ANALYSIS_WIDTH / sourceWidth;
    }

    private AnalysisResult measure(FrameSource source, AnalysisSettings settings, Evidence evidence, PointSink points)
            throws Exception {
        GrayFrame first = source.next();
        if (first == null) {
            return AnalysisResult.refused(Refusal.VIDEO_UNREADABLE, GateValues.none());
        }
        int width = first.gray().cols();
        int height = first.gray().rows();
        long firstTimestamp = first.timestampMicros();
        long lastTimestamp = firstTimestamp;
        double toSourcePixels = (double) source.sourceWidth() / width;
        double frameRate = source.frameRate();
        int step = Math.max(1, (int) Math.round(frameRate * PAIR_SECONDS));
        long maxMicros = (long) (settings.maxSeconds() * 1_000_000);

        List<Integer> waterCounts = new ArrayList<>();
        List<Integer> backgroundCounts = new ArrayList<>();
        List<double[]> waterVelocities = new ArrayList<>();  // vx, vy in analysis px/s, camera shift removed
        List<Double> backgroundResiduals = new ArrayList<>(); // px/s the background still "moved": our noise
        int pairsTotal = 0;
        int pairsUnstable = 0;

        try (Mat waterMask = mask(width, height, settings.region(), true);
             Mat backgroundMask = mask(width, height, settings.region(), false)) {
            GrayFrame previous = first;
            int framesSincePrevious = 0;
            GrayFrame frame;
            while ((frame = source.next()) != null) {
                if (frame.timestampMicros() - firstTimestamp > maxMicros) {
                    frame.close();
                    break;
                }
                if (++framesSincePrevious < step) {
                    frame.close();
                    continue;
                }
                framesSincePrevious = 0;
                double dt = (frame.timestampMicros() - previous.timestampMicros()) / 1e6;
                if (dt <= 0) {
                    frame.close(); // broken timestamp: skip this frame rather than divide by zero
                    continue;
                }
                lastTimestamp = frame.timestampMicros();
                pairsTotal++;

                List<float[]> water = track(previous.gray(), frame.gray(), waterMask, MAX_WATER_CORNERS);
                List<float[]> background = track(previous.gray(), frame.gray(), backgroundMask, MAX_BACKGROUND_CORNERS);
                waterCounts.add(water.size());
                backgroundCounts.add(background.size());
                evidence.offerFrame(previous.gray(), pairsTotal);
                background.forEach(evidence::addBank);

                double[] camera = medianShift(background);
                boolean cameraUnconfirmed = background.size() < MIN_BACKGROUND_TRACKS;
                if (cameraUnconfirmed || Math.hypot(camera[0], camera[1]) > CAMERA_SHIFT_PX) {
                    pairsUnstable++; // we can't trust this pair, so none of its points count
                } else {
                    for (float[] t : background) {
                        double rx = (t[2] - t[0] - camera[0]) / dt;
                        double ry = (t[3] - t[1] - camera[1]) / dt;
                        backgroundResiduals.add(Math.hypot(rx, ry));
                        points.bank(pairsTotal, t[0] / width, t[1] / height, rx * toSourcePixels, ry * toSourcePixels);
                    }
                    for (float[] t : water) {
                        double dx = t[2] - t[0] - camera[0];
                        double dy = t[3] - t[1] - camera[1];
                        waterVelocities.add(new double[]{dx / dt, dy / dt});
                        evidence.addWater(t[0], t[1], dx, dy, Math.hypot(dx, dy) / dt);
                        points.water(pairsTotal, t[0] / width, t[1] / height, dx / dt * toSourcePixels,
                                dy / dt * toSourcePixels);
                    }
                }
                previous.close();
                previous = frame;
            }
            previous.close();
        }

        double seconds = (lastTimestamp - firstTimestamp) / 1e6;
        int pairsUsed = pairsTotal - pairsUnstable;
        double waterMedian = median(waterCounts);
        double backgroundMedian = median(backgroundCounts);
        double unstableShare = pairsTotal == 0 ? 0 : (double) pairsUnstable / pairsTotal;
        int sourceWidth = source.sourceWidth();
        int sourceHeight = source.sourceHeight();

        // Gates, in order. Each one that fails stops the analysis with its reason.
        GateValues early = new GateValues(pairsTotal, pairsUsed, seconds, frameRate, sourceWidth, sourceHeight,
                waterMedian, backgroundMedian, unstableShare, null, null, null, null, null);
        if (pairsTotal < MIN_PAIRS || seconds < MIN_SECONDS) {
            return AnalysisResult.refused(Refusal.TOO_SHORT, early);
        }
        if (backgroundMedian < MIN_BACKGROUND_TRACKS) {
            return AnalysisResult.refused(Refusal.NO_FIXED_BACKGROUND, early);
        }
        if (unstableShare > MAX_UNSTABLE_SHARE || pairsUsed < MIN_PAIRS) {
            return AnalysisResult.refused(Refusal.CAMERA_MOVED, early);
        }

        // The background's leftover motion is our noise. If it's large, something outside the box is moving,
        // and a noise floor that high would hide real flow, so we refuse instead of calling it still.
        double noise = percentile(backgroundResiduals, 0.9);
        double threshold = Math.max(MIN_MOVING_PX_PER_SEC, NOISE_MULTIPLIER * noise);
        GateValues withNoise = new GateValues(pairsTotal, pairsUsed, seconds, frameRate, sourceWidth, sourceHeight,
                waterMedian, backgroundMedian, unstableShare, noise * toSourcePixels, threshold * toSourcePixels,
                null, null, null);
        if (noise > MAX_NOISE_PX_PER_SEC) {
            return AnalysisResult.refused(Refusal.BACKGROUND_MOVING, withNoise);
        }
        if (waterMedian < MIN_WATER_TRACKS) {
            return AnalysisResult.refused(Refusal.NOTHING_TO_TRACK, withNoise);
        }

        // "Moving" has to beat both a fixed floor and three times the background's own jitter.
        List<Double> allSpeeds = new ArrayList<>();
        List<double[]> moving = new ArrayList<>();
        for (double[] v : waterVelocities) {
            double speed = Math.hypot(v[0], v[1]);
            allSpeeds.add(speed);
            if (speed > threshold) {
                moving.add(v);
            }
        }
        double movingShare = (double) moving.size() / waterVelocities.size();
        double coherence = coherence(moving);

        GateValues gates = new GateValues(pairsTotal, pairsUsed, seconds, frameRate, sourceWidth, sourceHeight,
                waterMedian, backgroundMedian, unstableShare,
                noise * toSourcePixels, threshold * toSourcePixels, movingShare,
                moving.isEmpty() ? null : coherence, median(allSpeeds) * toSourcePixels);

        if (movingShare < MIN_MOVING_SHARE) {
            String reason = String.format(Locale.ROOT,
                    "We followed about %.0f points on the surface and %.0f%% of them stayed put.",
                    waterMedian, 100 * (1 - movingShare));
            return new AnalysisResult(Verdict.STILL, null, reason, null, null, null, null, gates, null, null);
        }
        if (coherence < MIN_COHERENCE) {
            return AnalysisResult.refused(Refusal.MIXED_DIRECTIONS, gates);
        }

        List<Double> movingSpeeds = new ArrayList<>();
        double sumX = 0;
        double sumY = 0;
        for (double[] v : moving) {
            double speed = Math.hypot(v[0], v[1]);
            movingSpeeds.add(speed);
            sumX += v[0] / speed;
            sumY += v[1] / speed;
        }
        double speedPx = median(movingSpeeds) * toSourcePixels;
        // Image rows grow downwards, so flip y to make 90 degrees mean "towards the top of the frame".
        double direction = (Math.toDegrees(Math.atan2(-sumY, sumX)) + 360) % 360;
        Double speedMetres = settings.metresPerPixel() == null ? null : speedPx * settings.metresPerPixel();

        String reason = String.format(Locale.ROOT,
                "%.0f%% of the points we followed moved together, at about %.0f pixels per second.",
                100 * movingShare, speedPx);
        String note = speedMetres == null
                ? "No scale was given, so there is no speed in metres per second."
                : "Surface speed only, assuming the camera looks straight down. It is not the river's average speed.";
        return new AnalysisResult(Verdict.MOVING, null, reason, note, speedPx, speedMetres, direction, gates, null, null);
    }

    /** Points found in one frame and followed to the next: {x0, y0, x1, y1} in analysis pixels. */
    private static List<float[]> track(Mat from, Mat to, Mat mask, int maxCorners) {
        List<float[]> tracks = new ArrayList<>();
        try (Mat start = new Mat(); Mat end = new Mat(); Mat back = new Mat();
             Mat status = new Mat(); Mat backStatus = new Mat(); Mat error = new Mat(); Mat backError = new Mat()) {
            goodFeaturesToTrack(from, start, maxCorners, CORNER_QUALITY, CORNER_MIN_DISTANCE, mask,
                    CORNER_BLOCK_SIZE, false, 0.04);
            if (start.rows() == 0) {
                return tracks;
            }
            calcOpticalFlowPyrLK(from, to, start, end, status, error, LK_WINDOW, LK_PYRAMID_LEVELS, LK_STOP, 0, 1e-4);
            calcOpticalFlowPyrLK(to, from, end, back, backStatus, backError, LK_WINDOW, LK_PYRAMID_LEVELS, LK_STOP, 0, 1e-4);
            try (FloatIndexer s = start.createIndexer(); FloatIndexer e = end.createIndexer();
                 FloatIndexer b = back.createIndexer(); UByteIndexer ok = status.createIndexer();
                 UByteIndexer backOk = backStatus.createIndexer()) {
                for (int i = 0; i < start.rows(); i++) {
                    if (ok.get(i, 0) == 0 || backOk.get(i, 0) == 0) {
                        continue;
                    }
                    float x0 = s.get(i, 0, 0);
                    float y0 = s.get(i, 0, 1);
                    // The round trip: a point that doesn't come back to where it started was tracked wrongly.
                    if (Math.hypot(b.get(i, 0, 0) - x0, b.get(i, 0, 1) - y0) > MAX_ROUND_TRIP_ERROR_PX) {
                        continue;
                    }
                    tracks.add(new float[]{x0, y0, e.get(i, 0, 0), e.get(i, 0, 1)});
                }
            }
        }
        return tracks;
    }

    /** White where we look for points: inside the water box, or outside it for the background. */
    private static Mat mask(int width, int height, Region region, boolean water) {
        int x0 = (int) Math.round(region.x() * width);
        int y0 = (int) Math.round(region.y() * height);
        int x1 = (int) Math.round((region.x() + region.width()) * width);
        int y1 = (int) Math.round((region.y() + region.height()) * height);
        int m = EDGE_MARGIN_PX;
        Mat mask = new Mat(height, width, CV_8UC1, new Scalar(water ? 0.0 : 255.0));
        if (water) {
            fill(mask, x0 + m, y0 + m, x1 - m, y1 - m, 255);
        } else {
            fill(mask, x0 - m, y0 - m, x1 + m, y1 + m, 0);
            // Also stay away from the frame's own border, where tracking is unreliable.
            fill(mask, 0, 0, width, m, 0);
            fill(mask, 0, height - m, width, height, 0);
            fill(mask, 0, 0, m, height, 0);
            fill(mask, width - m, 0, width, height, 0);
        }
        return mask;
    }

    private static void fill(Mat mask, int x0, int y0, int x1, int y1, double value) {
        if (x1 <= x0 || y1 <= y0) {
            return;
        }
        try (Rect rect = new Rect(x0, y0, x1 - x0, y1 - y0); Scalar color = new Scalar(value)) {
            rectangle(mask, rect, color, -1, 8, 0);
        }
    }

    private static double[] medianShift(List<float[]> tracks) {
        List<Double> dx = new ArrayList<>();
        List<Double> dy = new ArrayList<>();
        for (float[] t : tracks) {
            dx.add((double) (t[2] - t[0]));
            dy.add((double) (t[3] - t[1]));
        }
        return new double[]{median(dx), median(dy)};
    }

    /** Length of the average direction arrow: 1 when all points agree, near 0 when they scatter. */
    private static double coherence(List<double[]> vectors) {
        if (vectors.isEmpty()) {
            return 0;
        }
        double sumX = 0;
        double sumY = 0;
        for (double[] v : vectors) {
            double length = Math.hypot(v[0], v[1]);
            sumX += v[0] / length;
            sumY += v[1] / length;
        }
        return Math.hypot(sumX, sumY) / vectors.size();
    }

    static double median(Collection<? extends Number> values) {
        return percentile(values, 0.5);
    }

    static double percentile(Collection<? extends Number> values, double p) {
        if (values.isEmpty()) {
            return 0;
        }
        double[] sorted = values.stream().mapToDouble(Number::doubleValue).sorted().toArray();
        double index = p * (sorted.length - 1);
        int low = (int) Math.floor(index);
        int high = (int) Math.ceil(index);
        return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
    }
}
