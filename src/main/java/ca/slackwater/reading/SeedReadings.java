package ca.slackwater.reading;

import ca.slackwater.analysis.AnalysisSettings;
import ca.slackwater.analysis.Region;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Measures the real clips listed in clips/seed.csv when the app starts and the database is empty.
 * The database lives in memory, so every restart starts empty, and a judge opening the live site days later
 * still sees real readings, made by the engine that's running, not stored numbers.
 */
@Component
@ConditionalOnProperty(name = "slackwater.seed.enabled", havingValue = "true", matchIfMissing = true)
public class SeedReadings implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedReadings.class);

    private final ReadingService service;
    private final ReadingRepository repository;
    private final Path clipsDir;

    public SeedReadings(ReadingService service, ReadingRepository repository,
                        @Value("${slackwater.clips-dir:clips}") String clipsDir) {
        this.service = service;
        this.repository = repository;
        this.clipsDir = Path.of(clipsDir);
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        Path manifest = clipsDir.resolve("seed.csv");
        if (repository.count() > 0 || !Files.exists(manifest)) {
            log.info("Not seeding: {}", repository.count() > 0 ? "readings already exist" : "no " + manifest);
            return;
        }
        List<String[]> rows = new ArrayList<>();
        for (String line : Files.readAllLines(manifest, StandardCharsets.UTF_8)) {
            if (!line.isBlank() && !line.startsWith("#")) {
                rows.add(line.split(",", -1));
            }
        }
        // The list shows newest first, so measure the last row first. Everything is saved in one go at the end,
        // so a page that loads while seeding is under way sees no readings (and waits) rather than some of them.
        Collections.reverse(rows);
        List<Reading> readings = new ArrayList<>();
        for (String[] row : rows) {
            Reading reading = measure(row);
            if (reading != null) {
                readings.add(reading);
            }
        }
        repository.saveAll(readings);
        log.info("Seeded {} readings", readings.size());
    }

    private Reading measure(String[] row) {
        Path clip = clipsDir.resolve(row[0].trim());
        try {
            Region region = new Region(Double.parseDouble(row[1]), Double.parseDouble(row[2]),
                    Double.parseDouble(row[3]), Double.parseDouble(row[4]));
            Double scale = row[5].isBlank() ? null : Double.parseDouble(row[5]);
            // The service deletes what it measures, so give it a copy.
            Path copy = Files.createTempFile("slackwater-seed-", ".video");
            Files.copy(clip, copy, StandardCopyOption.REPLACE_EXISTING);
            Reading reading = service.prepare(copy, clip.getFileName().toString(), row[0].trim(),
                    new AnalysisSettings(region, scale), new Site(row[6].trim(), null, null));
            log.info("Measured {}: {}", clip.getFileName(), reading.getVerdict());
            return reading;
        } catch (Exception e) {
            log.warn("Could not seed {}: {}", clip, e.getMessage());
            return null;
        }
    }
}
