package ca.slackwater.analysis;

import org.bytedeco.javacpp.BytePointer;
import org.bytedeco.opencv.opencv_core.Mat;
import org.bytedeco.opencv.opencv_core.Point;
import org.bytedeco.opencv.opencv_core.Rect;
import org.bytedeco.opencv.opencv_core.Scalar;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

import static org.bytedeco.opencv.global.opencv_core.CV_8UC4;
import static org.bytedeco.opencv.global.opencv_imgcodecs.imencode;
import static org.bytedeco.opencv.global.opencv_imgproc.COLOR_GRAY2BGR;
import static org.bytedeco.opencv.global.opencv_imgproc.FONT_HERSHEY_SIMPLEX;
import static org.bytedeco.opencv.global.opencv_imgproc.LINE_AA;
import static org.bytedeco.opencv.global.opencv_imgproc.arrowedLine;
import static org.bytedeco.opencv.global.opencv_imgproc.circle;
import static org.bytedeco.opencv.global.opencv_imgproc.cvtColor;
import static org.bytedeco.opencv.global.opencv_imgproc.line;
import static org.bytedeco.opencv.global.opencv_imgproc.putText;
import static org.bytedeco.opencv.global.opencv_imgproc.rectangle;

/**
 * The picture behind a verdict: one real frame from the clip with the water box and the points we followed
 * drawn on it. Fast-moving water points are arrows, points that stayed put are dots, bank points are crosses
 * (amber arrows when the camera moved). It's what a reviewer, a judge or the person filming can check by eye.
 */
final class Evidence implements AutoCloseable {

    /** Arrows are stretched to show 0.4 s of motion (pairs are 0.1 s apart), so slow flow is still visible. */
    static final double ARROW_SCALE = 4;
    /** Enough arrows to show the flow, few enough to see the water under them. */
    private static final int MAX_WATER = 300;
    private static final int MAX_BANK = 400;
    /** The frame from this pair is kept, so the picture isn't the clip's very first, often blurry, frame. */
    private static final int FRAME_PAIR = 3;

    // Colours are blue-green-red, OpenCV's order.
    private static final double[] MOVING = {255, 228, 134};
    private static final double[] STAYED = {205, 205, 205};
    private static final double[] BANK = {228, 240, 243};
    private static final double[] WARN = {74, 180, 255};
    private static final double[] BOX = {61, 195, 242};

    private Mat frame;
    private final List<double[]> water = new ArrayList<>(); // x0, y0, dx, dy per pair, speed px/s (analysis)
    private final Random sampler = new Random(1); // fixed seed: the same clip always gives the same picture
    private int waterSeen;
    private final List<double[]> bank = new ArrayList<>();  // x0, y0, dx, dy per pair, raw

    void offerFrame(Mat gray, int pairNumber) {
        if (frame == null || pairNumber == FRAME_PAIR) {
            if (frame != null) {
                frame.close();
            }
            frame = gray.clone();
        }
    }

    /**
     * Keeps an even sample of every water track in the clip (reservoir sampling), so the arrows come from the
     * whole clip, not just its first few pairs.
     */
    void addWater(float x0, float y0, double dx, double dy, double speed) {
        double[] track = {x0, y0, dx, dy, speed};
        waterSeen++;
        if (water.size() < MAX_WATER) {
            water.add(track);
        } else {
            int slot = sampler.nextInt(waterSeen);
            if (slot < MAX_WATER) {
                water.set(slot, track);
            }
        }
    }

    void addBank(float[] track) {
        if (bank.size() < MAX_BANK) {
            bank.add(new double[]{track[0], track[1], track[2] - track[0], track[3] - track[1]});
        }
    }

    /**
     * The full picture: the frame, the marks and a caption.
     *
     * @param threshold the "moving" bar in analysis px/s, or null if the analysis stopped before computing it
     */
    byte[] render(Region region, Double threshold, AnalysisResult result) {
        if (frame == null) {
            return null;
        }
        try (Mat image = new Mat()) {
            cvtColor(frame, image, COLOR_GRAY2BGR);
            image.convertTo(image, -1, 0.8, 0); // dim the frame a little so the marks stand out
            drawMarks(image, region, threshold, result);
            caption(image, result, image.cols(), image.rows());
            return png(image);
        }
    }

    /**
     * Only the marks, on a transparent background the size of the analysed frame, so the page can lay them over
     * the clip itself while it plays (the camera didn't move, so the marks stay lined up).
     */
    byte[] renderOverlay(Region region, Double threshold, AnalysisResult result) {
        if (frame == null) {
            return null;
        }
        try (Scalar clear = new Scalar(0, 0, 0, 0); Mat image = new Mat(frame.rows(), frame.cols(), CV_8UC4, clear)) {
            drawMarks(image, region, threshold, result);
            return png(image);
        }
    }

    private void drawMarks(Mat image, Region region, Double threshold, AnalysisResult result) {
        int width = image.cols();
        int height = image.rows();
        boolean mixed = result.refusal() == Refusal.MIXED_DIRECTIONS;
        for (double[] b : bank) {
            boolean shifted = Math.hypot(b[2], b[3]) > FlowAnalyzer.CAMERA_SHIFT_PX;
            cross(image, b[0], b[1], shifted ? WARN : BANK);
            if (shifted) {
                arrow(image, b[0], b[1], b[2], b[3], WARN);
            }
        }
        for (double[] w : water) {
            boolean moved = threshold != null && w[4] > threshold;
            if (moved) {
                arrow(image, w[0], w[1], w[2], w[3], mixed ? WARN : MOVING);
            } else {
                dot(image, w[0], w[1], STAYED);
            }
        }
        box(image, region, width, height);
    }

    private static byte[] png(Mat image) {
        try (BytePointer extension = new BytePointer(".png"); BytePointer png = new BytePointer()) {
            imencode(extension, image, png);
            byte[] bytes = new byte[(int) png.limit()];
            png.get(bytes);
            return bytes;
        }
    }

    private static void arrow(Mat image, double x, double y, double dx, double dy, double[] bgr) {
        try (Point from = point(x, y); Point to = point(x + dx * ARROW_SCALE, y + dy * ARROW_SCALE);
             Scalar color = scalar(bgr)) {
            arrowedLine(image, from, to, color, 1, LINE_AA, 0, 0.3);
        }
    }

    private static void dot(Mat image, double x, double y, double[] bgr) {
        try (Point center = point(x, y); Scalar color = scalar(bgr)) {
            circle(image, center, 2, color, 1, LINE_AA, 0);
        }
    }

    private static void cross(Mat image, double x, double y, double[] bgr) {
        try (Scalar color = scalar(bgr);
             Point left = point(x - 3, y); Point right = point(x + 3, y);
             Point top = point(x, y - 3); Point bottom = point(x, y + 3)) {
            line(image, left, right, color, 1, LINE_AA, 0);
            line(image, top, bottom, color, 1, LINE_AA, 0);
        }
    }

    private static void box(Mat image, Region region, int width, int height) {
        int x = (int) Math.round(region.x() * width);
        int y = (int) Math.round(region.y() * height);
        int w = (int) Math.round(region.width() * width);
        int h = (int) Math.round(region.height() * height);
        try (Rect rect = new Rect(x, y, Math.max(1, w - 1), Math.max(1, h - 1)); Scalar color = scalar(BOX)) {
            rectangle(image, rect, color, 2, LINE_AA, 0);
        }
    }

    /** A strip along the bottom saying what the picture shows, so a screenshot explains itself. */
    private static void caption(Mat image, AnalysisResult result, int width, int height) {
        String verdict = switch (result.verdict()) {
            case MOVING -> result.surfaceSpeedMetresPerSec() != null
                    ? String.format(Locale.ROOT, "MOVING  %.2f m/s surface", result.surfaceSpeedMetresPerSec())
                    : String.format(Locale.ROOT, "MOVING  %.0f px/s", result.surfaceSpeedPxPerSec());
            case STILL -> "STILL";
            case REFUSED -> "REFUSED  " + result.refusal().name().replace('_', ' ');
        };
        String text = "SlackWater " + FlowAnalyzer.ENGINE_VERSION + "  |  " + verdict + "  |  arrows = 0.4 s of motion";
        try (Rect strip = new Rect(0, height - 22, width, 22); Scalar dark = new Scalar(20, 20, 20, 0);
             Point at = new Point(8, height - 7); Scalar light = scalar(BANK); BytePointer words = new BytePointer(text)) {
            rectangle(image, strip, dark, -1, LINE_AA, 0);
            putText(image, words, at, FONT_HERSHEY_SIMPLEX, 0.42, light, 1, LINE_AA, false);
        }
    }

    private static Point point(double x, double y) {
        return new Point((int) Math.round(x), (int) Math.round(y));
    }

    private static Scalar scalar(double[] bgr) {
        return new Scalar(bgr[0], bgr[1], bgr[2], 255); // the 255 is opacity, used by the overlay
    }

    @Override
    public void close() {
        if (frame != null) {
            frame.close();
        }
    }
}
