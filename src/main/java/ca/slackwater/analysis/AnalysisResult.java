package ca.slackwater.analysis;

/**
 * What the analyzer decided, and the evidence for it.
 *
 * @param surfaceSpeedPxPerSec     only for MOVING; in the original video's pixels per second
 * @param surfaceSpeedMetresPerSec only for MOVING with a scale; this is surface velocity, not mean river speed
 * @param directionDegrees         only for MOVING; 0 = towards the right of the frame, 90 = towards the top
 * @param evidencePng              one frame with the water box and the tracked points drawn on it; null if the
 *                                 video couldn't be read
 * @param overlayPng               the same marks on a transparent background, to lay over the playing clip
 */
public record AnalysisResult(
        Verdict verdict,
        Refusal refusal,
        String reason,
        String note,
        Double surfaceSpeedPxPerSec,
        Double surfaceSpeedMetresPerSec,
        Double directionDegrees,
        GateValues gates,
        byte[] evidencePng,
        byte[] overlayPng) {

    public static AnalysisResult refused(Refusal refusal, GateValues gates) {
        return new AnalysisResult(Verdict.REFUSED, refusal, refusal.message(), null, null, null, null, gates, null, null);
    }

    public AnalysisResult withEvidence(byte[] png, byte[] overlay) {
        return new AnalysisResult(verdict, refusal, reason, note, surfaceSpeedPxPerSec, surfaceSpeedMetresPerSec,
                directionDegrees, gates, png, overlay);
    }
}
