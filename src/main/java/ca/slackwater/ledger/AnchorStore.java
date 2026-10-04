package ca.slackwater.ledger;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * The anchors, kept in clips/anchors.csv next to the clips. A reading's fingerprint is the same every time the same
 * clip is measured with the same settings and engine, so the server seeded on startup finds its anchors here,
 * even on a machine without a DKG node (like the live site).
 */
@Component
public class AnchorStore {

    private static final String HEADER = "# fingerprint,locator,ual,tx,anchoredAt";

    private final Path file;
    private final Map<String, Anchor> anchors = new LinkedHashMap<>();

    public AnchorStore(@Value("${slackwater.clips-dir:clips}") String clipsDir) {
        this.file = Path.of(clipsDir).resolve("anchors.csv");
        load();
    }

    public synchronized Optional<Anchor> find(String fingerprint) {
        return Optional.ofNullable(anchors.get(fingerprint));
    }

    public synchronized void save(Anchor anchor) {
        anchors.put(anchor.fingerprint(), anchor);
        StringBuilder out = new StringBuilder(HEADER).append('\n');
        for (Anchor a : anchors.values()) {
            out.append(String.join(",", a.fingerprint(), a.locator(), nz(a.ual()), nz(a.tx()), nz(a.anchoredAt()))).append('\n');
        }
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, out, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not write " + file, e);
        }
    }

    private void load() {
        if (!Files.exists(file)) {
            return;
        }
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                if (line.isBlank() || line.startsWith("#")) {
                    continue;
                }
                String[] c = line.split(",", -1);
                if (c.length >= 5) {
                    anchors.put(c[0], new Anchor(c[0], c[1], c[2], c[3], c[4]));
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + file, e);
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
