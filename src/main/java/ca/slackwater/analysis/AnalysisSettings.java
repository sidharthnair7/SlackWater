package ca.slackwater.analysis;

import java.util.Locale;

/**
 * What the user chose for one measurement. These go into the fingerprint, because the same clip
 * with a different water box or scale is a different measurement.
 *
 * @param metresPerPixel optional scale in the original video's pixels; null means no scale, so no m/s
 * @param maxSeconds     how much of the clip to analyse
 */
public record AnalysisSettings(Region region, Double metresPerPixel, double maxSeconds) {

    public static final double DEFAULT_MAX_SECONDS = 15;

    public AnalysisSettings {
        if (region == null) {
            throw new IllegalArgumentException("A water box is required.");
        }
        if (metresPerPixel != null && metresPerPixel <= 0) {
            throw new IllegalArgumentException("The scale must be a positive number of metres per pixel.");
        }
    }

    public AnalysisSettings(Region region, Double metresPerPixel) {
        this(region, metresPerPixel, DEFAULT_MAX_SECONDS);
    }

    /** A fixed text form of the settings, so the same choices always hash to the same fingerprint. */
    public String canonical() {
        return String.format(Locale.ROOT, "region=%.4f,%.4f,%.4f,%.4f;mpp=%s;max=%.1f",
                region.x(), region.y(), region.width(), region.height(),
                metresPerPixel == null ? "none" : String.format(Locale.ROOT, "%.6f", metresPerPixel),
                maxSeconds);
    }
}
