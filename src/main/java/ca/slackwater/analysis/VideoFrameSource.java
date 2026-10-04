package ca.slackwater.analysis;

import org.bytedeco.ffmpeg.global.avutil;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.Frame;
import org.bytedeco.javacv.OpenCVFrameConverter;
import org.bytedeco.opencv.opencv_core.Mat;
import org.bytedeco.opencv.opencv_core.Size;

import java.io.File;

import static org.bytedeco.opencv.global.opencv_imgproc.INTER_AREA;
import static org.bytedeco.opencv.global.opencv_imgproc.resize;

/**
 * Reads a video file with FFmpeg. FFmpeg decodes almost any phone format, and asking it for grey
 * frames directly saves a colour conversion on every frame.
 */
public class VideoFrameSource implements FrameSource {

    /** Wider frames are shrunk to this. Tracking is fast at 640 px and still precise enough. */
    public static final int ANALYSIS_WIDTH = 640;

    static {
        // FFmpeg prints a warning per frame for some phone formats; only real errors are worth a log line.
        avutil.av_log_set_level(avutil.AV_LOG_ERROR);
    }

    private final FFmpegFrameGrabber grabber;
    private final OpenCVFrameConverter.ToMat converter = new OpenCVFrameConverter.ToMat();

    public VideoFrameSource(File file) throws Exception {
        grabber = new FFmpegFrameGrabber(file);
        grabber.setPixelFormat(avutil.AV_PIX_FMT_GRAY8);
        grabber.start();
    }

    @Override
    public GrayFrame next() throws Exception {
        Frame frame = grabber.grabImage();
        if (frame == null) {
            return null;
        }
        // The converter reuses one buffer for every frame, so copy out of it before the next grab.
        Mat decoded = converter.convert(frame);
        Mat gray = new Mat();
        if (decoded.cols() > ANALYSIS_WIDTH) {
            int height = (int) Math.round(decoded.rows() * (double) ANALYSIS_WIDTH / decoded.cols());
            try (Size size = new Size(ANALYSIS_WIDTH, height)) {
                resize(decoded, gray, size, 0, 0, INTER_AREA);
            }
        } else {
            decoded.copyTo(gray);
        }
        return new GrayFrame(gray, frame.timestamp);
    }

    @Override
    public double frameRate() {
        return grabber.getFrameRate();
    }

    @Override
    public int sourceWidth() {
        return grabber.getImageWidth();
    }

    @Override
    public int sourceHeight() {
        return grabber.getImageHeight();
    }

    @Override
    public void close() throws Exception {
        grabber.close();
        converter.close();
    }
}
