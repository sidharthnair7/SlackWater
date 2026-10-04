package ca.slackwater.reading;

import ca.slackwater.analysis.AnalysisSettings;
import ca.slackwater.analysis.Region;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/readings")
public class ReadingController {

    private final ReadingService service;
    private final ReadingRepository repository;

    public ReadingController(ReadingService service, ReadingRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    /**
     * Upload a clip with the water box (fractions of the frame, 0 to 1) and get the reading back.
     * The scale and the place are optional.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Reading> measure(
            @RequestParam("video") MultipartFile video,
            @RequestParam("regionX") double regionX,
            @RequestParam("regionY") double regionY,
            @RequestParam("regionWidth") double regionWidth,
            @RequestParam("regionHeight") double regionHeight,
            @RequestParam(value = "metresPerPixel", required = false) Double metresPerPixel,
            @RequestParam(value = "siteName", required = false) String siteName,
            @RequestParam(value = "latitude", required = false) Double latitude,
            @RequestParam(value = "longitude", required = false) Double longitude) throws IOException {
        if (video.isEmpty()) {
            throw new IllegalArgumentException("The video is empty.");
        }
        AnalysisSettings settings = new AnalysisSettings(
                new Region(regionX, regionY, regionWidth, regionHeight), metresPerPixel);

        Path temp = Files.createTempFile("slackwater-", ".video");
        video.transferTo(temp);
        Reading reading = service.measure(temp, video.getOriginalFilename(), settings,
                new Site(siteName, latitude, longitude));
        return ResponseEntity.status(HttpStatus.CREATED).body(reading);
    }

    /** Newest first. How the inspector screen should rank them is still to be decided. */
    @GetMapping
    public List<Reading> list() {
        return repository.findAllByOrderByCreatedAtDesc();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Reading> get(@PathVariable("id") long id) {
        return repository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /** The frame with the water box and tracked points drawn on it. */
    @GetMapping(value = "/{id}/evidence.png", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> evidence(@PathVariable("id") long id) {
        return repository.findById(id)
                .filter(Reading::isEvidenceAvailable)
                .map(reading -> ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(reading.getEvidencePng()))
                .orElse(ResponseEntity.notFound().build());
    }

    /** Only the marks, transparent, the size of the analysed frame: lay it over the clip while it plays. */
    @GetMapping(value = "/{id}/overlay.png", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> overlay(@PathVariable("id") long id) {
        return repository.findById(id)
                .filter(reading -> reading.getOverlayPng() != null)
                .map(reading -> ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(reading.getOverlayPng()))
                .orElse(ResponseEntity.notFound().build());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
