package ca.slackwater.reading;

import ca.slackwater.analysis.AnalysisResult;
import ca.slackwater.analysis.GateValues;
import ca.slackwater.analysis.Refusal;
import ca.slackwater.analysis.Verdict;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.FetchType;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One measurement, kept with everything needed to trust it: what was decided, every gate value behind
 * the decision, and the fingerprint tying it to the exact clip, settings and engine version.
 * Refusals are saved too, because "we couldn't tell, and here's why" is a result.
 */
@Entity
@Getter
@NoArgsConstructor
public class Reading {

    @Id
    @GeneratedValue
    private Long id;

    private Instant createdAt;

    // Where and what
    private String siteName;
    private Double latitude;
    private Double longitude;
    private String fileName;

    // The record
    @Column(length = 64)
    private String fingerprint;
    @Column(length = 64)
    private String videoSha256;
    private String settings;
    private String engineVersion;

    // The decision
    @Enumerated(EnumType.STRING)
    private Verdict verdict;
    @Enumerated(EnumType.STRING)
    private Refusal refusal;
    @Column(length = 500)
    private String reason;
    @Column(length = 500)
    private String note;
    private Double surfaceSpeedPxPerSec;
    private Double surfaceSpeedMetresPerSec;
    private Double directionDegrees;

    // The gate values behind it
    private Integer pairsTotal;
    private Integer pairsUsed;
    private Double secondsAnalysed;
    private Double frameRate;
    private Integer width;
    private Integer height;
    private Double waterTracksMedian;
    private Double backgroundTracksMedian;
    private Double cameraUnstableShare;
    private Double noiseFloorPxPerSec;
    private Double movingThresholdPxPerSec;
    private Double movingShare;
    private Double directionCoherence;
    private Double medianWaterSpeedPxPerSec;

    /** The evidence frame as a PNG. Served on its own URL, so it's left out of the JSON. */
    @Lob
    @Basic(fetch = FetchType.LAZY)
    @JsonIgnore
    private byte[] evidencePng;

    /** The same marks on a transparent background, to lay over the clip while it plays. */
    @Lob
    @Basic(fetch = FetchType.LAZY)
    @JsonIgnore
    private byte[] overlayPng;

    /** Lets the page know whether /api/readings/{id}/evidence.png and overlay.png exist. */
    public boolean isEvidenceAvailable() {
        return evidencePng != null;
    }

    static Reading of(AnalysisResult result, Site site, String fileName, String videoSha256,
                      String settings, String engineVersion) {
        Reading r = new Reading();
        r.createdAt = Instant.now();
        r.siteName = site.name();
        r.latitude = site.latitude();
        r.longitude = site.longitude();
        r.fileName = fileName;
        r.videoSha256 = videoSha256;
        r.settings = settings;
        r.engineVersion = engineVersion;
        r.fingerprint = Fingerprint.ofReading(videoSha256, settings, engineVersion);

        r.verdict = result.verdict();
        r.refusal = result.refusal();
        r.reason = result.reason();
        r.note = result.note();
        r.surfaceSpeedPxPerSec = result.surfaceSpeedPxPerSec();
        r.surfaceSpeedMetresPerSec = result.surfaceSpeedMetresPerSec();
        r.directionDegrees = result.directionDegrees();

        GateValues g = result.gates();
        r.pairsTotal = g.pairsTotal();
        r.pairsUsed = g.pairsUsed();
        r.secondsAnalysed = g.secondsAnalysed();
        r.frameRate = g.frameRate();
        r.width = g.width();
        r.height = g.height();
        r.waterTracksMedian = g.waterTracksMedian();
        r.backgroundTracksMedian = g.backgroundTracksMedian();
        r.cameraUnstableShare = g.cameraUnstableShare();
        r.noiseFloorPxPerSec = g.noiseFloorPxPerSec();
        r.movingThresholdPxPerSec = g.movingThresholdPxPerSec();
        r.movingShare = g.movingShare();
        r.directionCoherence = g.directionCoherence();
        r.medianWaterSpeedPxPerSec = g.medianWaterSpeedPxPerSec();
        r.evidencePng = result.evidencePng();
        r.overlayPng = result.overlayPng();
        return r;
    }
}
