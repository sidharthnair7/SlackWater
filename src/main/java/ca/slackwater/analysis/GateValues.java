package ca.slackwater.analysis;

/**
 * The numbers behind a verdict, so anyone can see why it passed or was refused.
 * Speeds are in the original video's pixels per second. A value is null when the analysis
 * stopped at an earlier gate and never computed it.
 */
public record GateValues(
        Integer pairsTotal,
        Integer pairsUsed,
        Double secondsAnalysed,
        Double frameRate,
        Integer width,
        Integer height,
        Double waterTracksMedian,
        Double backgroundTracksMedian,
        Double cameraUnstableShare,
        Double noiseFloorPxPerSec,
        Double movingThresholdPxPerSec,
        Double movingShare,
        Double directionCoherence,
        Double medianWaterSpeedPxPerSec) {

    public static GateValues none() {
        return new GateValues(null, null, null, null, null, null, null, null, null, null, null, null, null, null);
    }
}
