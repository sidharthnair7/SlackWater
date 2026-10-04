package ca.slackwater.analysis;

import org.bytedeco.javacpp.indexer.DoubleIndexer;
import org.bytedeco.opencv.opencv_core.Mat;
import org.bytedeco.opencv.opencv_core.Rect;
import org.bytedeco.opencv.opencv_core.Scalar;
import org.bytedeco.opencv.opencv_core.Size;

import java.util.Random;

import static org.bytedeco.opencv.global.opencv_core.BORDER_REFLECT;
import static org.bytedeco.opencv.global.opencv_core.CV_64F;
import static org.bytedeco.opencv.global.opencv_core.CV_8UC1;
import static org.bytedeco.opencv.global.opencv_imgproc.GaussianBlur;
import static org.bytedeco.opencv.global.opencv_imgproc.INTER_LINEAR;
import static org.bytedeco.opencv.global.opencv_imgproc.WARP_INVERSE_MAP;
import static org.bytedeco.opencv.global.opencv_imgproc.warpAffine;

/**
 * A made-up clip where we know the exact truth: a textured strip of "water" across the middle third
 * slides a set number of pixels per frame, between two fixed textured "banks".
 * This is the only kind of clip where the right answer is known to the decimal.
 */
class SyntheticClip implements FrameSource {

    static final int WIDTH = 640;
    static final int HEIGHT = 360;
    static final int BAND_TOP = 120;
    static final int BAND_HEIGHT = 120;
    /** The water box that matches the strip. */
    static final Region WATER = new Region(0, 1.0 / 3, 1, 1.0 / 3);

    private static final int STRIPES = 8;

    private final int frames;
    private final double fps;
    private final double dxPerFrame;
    private final double dyPerFrame;
    private final double shakePx;
    private final boolean flatWater;
    private final boolean mixedDirections;
    private final Random random = new Random(42);
    private final Mat banks;
    private final Mat water;
    private final double[][] stripeDirections = new double[STRIPES][2];
    private int index;

    private SyntheticClip(int frames, double fps, double dxPerFrame, double dyPerFrame, double shakePx,
                          boolean flatWater, boolean mixedDirections) {
        this.frames = frames;
        this.fps = fps;
        this.dxPerFrame = dxPerFrame;
        this.dyPerFrame = dyPerFrame;
        this.shakePx = shakePx;
        this.flatWater = flatWater;
        this.mixedDirections = mixedDirections;
        this.banks = texture(WIDTH, HEIGHT);
        this.water = texture(WIDTH, BAND_HEIGHT);
        for (int s = 0; s < STRIPES; s++) {
            double angle = random.nextDouble() * 2 * Math.PI;
            stripeDirections[s][0] = 2 * Math.cos(angle);
            stripeDirections[s][1] = 2 * Math.sin(angle);
        }
    }

    static SyntheticClip flowing(double dxPerFrame, double dyPerFrame) {
        return new SyntheticClip(150, 30, dxPerFrame, dyPerFrame, 0, false, false);
    }

    static SyntheticClip still() {
        return flowing(0, 0);
    }

    static SyntheticClip shakyCamera() {
        return new SyntheticClip(150, 30, 2, 0, 3, false, false);
    }

    static SyntheticClip flatWater() {
        return new SyntheticClip(150, 30, 2, 0, 0, true, false);
    }

    static SyntheticClip mixedDirections() {
        return new SyntheticClip(150, 30, 0, 0, 0, false, true);
    }

    static SyntheticClip tooShort() {
        return new SyntheticClip(10, 30, 2, 0, 0, false, false);
    }

    @Override
    public GrayFrame next() {
        if (index >= frames) {
            return null;
        }
        int i = index++;
        double camX = shakePx == 0 ? 0 : (random.nextDouble() * 2 - 1) * shakePx;
        double camY = shakePx == 0 ? 0 : (random.nextDouble() * 2 - 1) * shakePx;

        Mat frame = new Mat();
        shifted(banks, frame, WIDTH, HEIGHT, camX, camY);
        try (Mat band = new Mat(frame, new Rect(0, BAND_TOP, WIDTH, BAND_HEIGHT))) {
            if (flatWater) {
                band.put(new Scalar(128.0));
            } else if (mixedDirections) {
                int stripeWidth = WIDTH / STRIPES;
                for (int s = 0; s < STRIPES; s++) {
                    try (Mat moved = new Mat();
                         Mat target = new Mat(band, new Rect(s * stripeWidth, 0, stripeWidth, BAND_HEIGHT));
                         Mat source = new Mat(water, new Rect(s * stripeWidth, 0, stripeWidth, BAND_HEIGHT))) {
                        shifted(source, moved, stripeWidth, BAND_HEIGHT,
                                camX - i * stripeDirections[s][0], camY - i * stripeDirections[s][1]);
                        moved.copyTo(target);
                    }
                }
            } else {
                try (Mat moved = new Mat()) {
                    // Content that moves right by dx shows, at x, what used to be at x - dx.
                    shifted(water, moved, WIDTH, BAND_HEIGHT, camX - i * dxPerFrame, camY - i * dyPerFrame);
                    moved.copyTo(band);
                }
            }
        }
        return new GrayFrame(frame, Math.round(i * 1_000_000 / fps));
    }

    /** dst(x, y) = src(x + offsetX, y + offsetY), with sub-pixel accuracy and mirrored edges. */
    private static void shifted(Mat src, Mat dst, int width, int height, double offsetX, double offsetY) {
        try (Mat transform = new Mat(2, 3, CV_64F); DoubleIndexer m = transform.createIndexer();
             Size size = new Size(width, height); Scalar border = new Scalar(0.0)) {
            m.put(0, 0, 1);
            m.put(0, 1, 0);
            m.put(0, 2, offsetX);
            m.put(1, 0, 0);
            m.put(1, 1, 1);
            m.put(1, 2, offsetY);
            warpAffine(src, dst, transform, size, INTER_LINEAR | WARP_INVERSE_MAP, BORDER_REFLECT, border);
        }
    }

    /** Smoothed random noise: full of corners to track, like foam, leaves and ripples. */
    private Mat texture(int width, int height) {
        byte[] bytes = new byte[width * height];
        random.nextBytes(bytes);
        try (Mat noise = new Mat(height, width, CV_8UC1); Size kernel = new Size(0, 0)) {
            noise.data().put(bytes);
            Mat smooth = new Mat();
            GaussianBlur(noise, smooth, kernel, 1.5);
            smooth.convertTo(smooth, -1, 4.0, -382.5); // stretch the contrast back up after blurring
            return smooth;
        }
    }

    @Override
    public double frameRate() {
        return fps;
    }

    @Override
    public int sourceWidth() {
        return WIDTH;
    }

    @Override
    public int sourceHeight() {
        return HEIGHT;
    }

    @Override
    public void close() {
        banks.close();
        water.close();
    }
}
