package ca.slackwater.reading;

import ca.slackwater.analysis.AnalysisResult;
import ca.slackwater.analysis.AnalysisSettings;
import ca.slackwater.analysis.FlowAnalyzer;
import ca.slackwater.analysis.GateValues;
import ca.slackwater.analysis.Refusal;
import ca.slackwater.analysis.VideoFrameSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@Service
public class ReadingService {

    private static final Logger log = LoggerFactory.getLogger(ReadingService.class);

    private final ReadingRepository repository;
    private final FlowAnalyzer analyzer = new FlowAnalyzer();

    public ReadingService(ReadingRepository repository) {
        this.repository = repository;
    }

    /**
     * Measures one clip and saves the reading. The clip itself is deleted afterwards: only its hash is kept,
     * which is enough to prove which clip a reading came from without storing anyone's video.
     */
    public Reading measure(Path video, String fileName, AnalysisSettings settings, Site site) throws IOException {
        return measure(video, fileName, null, settings, site);
    }

    /** @param clipPath where the original stays under clips/, so the page can play it; null for uploads */
    public Reading measure(Path video, String fileName, String clipPath, AnalysisSettings settings, Site site)
            throws IOException {
        return repository.save(prepare(video, fileName, clipPath, settings, site));
    }

    /** Measures a clip into a Reading without saving it, then deletes the clip. */
    Reading prepare(Path video, String fileName, String clipPath, AnalysisSettings settings, Site site)
            throws IOException {
        try {
            String videoSha256 = Fingerprint.ofFile(video);
            AnalysisResult result = analyze(video, settings);
            return Reading.of(result, site, fileName, clipPath, videoSha256, settings.canonical(),
                    FlowAnalyzer.ENGINE_VERSION);
        } finally {
            Files.deleteIfExists(video);
        }
    }

    private AnalysisResult analyze(Path video, AnalysisSettings settings) {
        try (VideoFrameSource source = new VideoFrameSource(video.toFile())) {
            return analyzer.analyze(source, settings);
        } catch (Exception e) {
            log.warn("Could not read video {}: {}", video, e.getMessage());
            return AnalysisResult.refused(Refusal.VIDEO_UNREADABLE, GateValues.none());
        }
    }
}
