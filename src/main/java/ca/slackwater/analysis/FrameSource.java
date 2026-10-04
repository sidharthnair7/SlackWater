package ca.slackwater.analysis;

/**
 * Anything that hands the analyzer frames one at a time: a real video file, or a synthetic clip in tests.
 */
public interface FrameSource extends AutoCloseable {

    /** The next frame, or null when the clip ends. The caller closes it. */
    GrayFrame next() throws Exception;

    double frameRate();

    /** Width of the original video, so speeds can be reported in the video's own pixels. */
    int sourceWidth();

    int sourceHeight();
}
