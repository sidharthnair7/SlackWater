package ca.slackwater.analysis;

import org.bytedeco.ffmpeg.global.avcodec;
import org.bytedeco.ffmpeg.global.avutil;
import org.bytedeco.javacv.FFmpegFrameRecorder;
import org.bytedeco.javacv.OpenCVFrameConverter;

import java.nio.file.Path;

/** Writes a synthetic clip to a real video file, so tests go through the same FFmpeg path as uploads. */
public final class ClipFiles {

    private ClipFiles() {
    }

    /** 5 seconds of water moving right at exactly 60 px/s, saved losslessly so the truth survives. */
    public static Path writeFlowingClip(Path dir) throws Exception {
        return write(SyntheticClip.flowing(2, 0), dir.resolve("flowing.mkv"));
    }

    static Path write(SyntheticClip clip, Path file) throws Exception {
        try (clip;
             FFmpegFrameRecorder recorder = new FFmpegFrameRecorder(file.toFile(), SyntheticClip.WIDTH, SyntheticClip.HEIGHT, 0);
             OpenCVFrameConverter.ToMat converter = new OpenCVFrameConverter.ToMat()) {
            recorder.setFormat("matroska");
            recorder.setVideoCodec(avcodec.AV_CODEC_ID_FFV1);
            recorder.setPixelFormat(avutil.AV_PIX_FMT_GRAY8);
            recorder.setFrameRate(clip.frameRate());
            recorder.start();
            for (GrayFrame next = clip.next(); next != null; next = clip.next()) {
                try (GrayFrame frame = next) {
                    recorder.record(converter.convert(frame.gray()));
                }
            }
            recorder.stop();
        }
        return file;
    }
}
