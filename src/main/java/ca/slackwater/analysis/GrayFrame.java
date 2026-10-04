package ca.slackwater.analysis;

import org.bytedeco.opencv.opencv_core.Mat;

/**
 * One video frame, already turned grey and shrunk to analysis size, plus when it was shown.
 * The timestamp comes from the video itself, because phone clips often have a variable frame rate.
 */
public record GrayFrame(Mat gray, long timestampMicros) implements AutoCloseable {

    @Override
    public void close() {
        gray.close();
    }
}
