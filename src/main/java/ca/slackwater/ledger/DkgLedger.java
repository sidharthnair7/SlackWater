package ca.slackwater.ledger;

import ca.slackwater.reading.Reading;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Anchors readings on the OriginTrail DKG through the node's command-line tool, the same way an operator would:
 * {@code dkg ka create <name> -c <context graph> -f <asset.ttl> --share} puts the reading in the context graph's
 * Shared Working Memory (free, no chain transaction), and {@code dkg query} reads it back.
 *
 * <p>Moving an asset on-chain (Verifiable Memory on Base Sepolia) costs gas, so the app never does it: the operator
 * runs {@code dkg ka publish} and records the UAL in clips/anchors.csv. Off by default; the live site, which has no
 * node, still shows the anchors from that file.
 */
@Service
public class DkgLedger {

    private static final Pattern DID = Pattern.compile("(did:dkg:\\S+)");

    private final boolean enabled;
    private final String cli;
    private final String contextGraph;
    private final long timeoutSeconds;
    private final AnchorStore store;
    private final Function<List<String>, String> runner;

    @Autowired
    public DkgLedger(@Value("${slackwater.dkg.enabled:false}") boolean enabled,
                     @Value("${slackwater.dkg.cli:dkg}") String cli,
                     @Value("${slackwater.dkg.context-graph:0x5Ea07Ffddc58Dd261102746E6651747E18429dbe/slackwater}") String contextGraph,
                     @Value("${slackwater.dkg.timeout-seconds:120}") long timeoutSeconds,
                     AnchorStore store) {
        this(enabled, cli, contextGraph, timeoutSeconds, store, null);
    }

    /** For tests: a stand-in for the dkg command. */
    DkgLedger(boolean enabled, String cli, String contextGraph, long timeoutSeconds, AnchorStore store,
              Function<List<String>, String> runner) {
        this.enabled = enabled;
        this.cli = cli;
        this.contextGraph = contextGraph;
        this.timeoutSeconds = timeoutSeconds;
        this.store = store;
        this.runner = runner != null ? runner : this::run;
    }

    public boolean enabled() {
        return enabled;
    }

    public String contextGraph() {
        return contextGraph;
    }

    /** Shares the reading to the context graph's Shared Working Memory and records the anchor. */
    public Anchor anchor(Reading reading) {
        if (!enabled) {
            throw new IllegalStateException("The DKG isn't enabled on this server.");
        }
        var existing = store.find(reading.getFingerprint());
        if (existing.isPresent()) {
            return existing.get();
        }
        Path ttl = temp(".ttl", ReadingAsset.turtle(reading));
        try {
            String output = runner.apply(List.of(cli, "ka", "create", ReadingAsset.name(reading),
                    "-c", contextGraph, "-f", ttl.toString(), "--share"));
            Matcher did = DID.matcher(output);
            String locator = did.find() ? did.group(1) : "did:dkg:context-graph:" + contextGraph + "/" + ReadingAsset.name(reading);
            Anchor anchor = new Anchor(reading.getFingerprint(), locator, "", "", Instant.now().toString());
            store.save(anchor);
            return anchor;
        } finally {
            delete(ttl);
        }
    }

    /** Asks the DKG whether it holds this reading with this exact fingerprint. */
    public boolean verify(Reading reading) {
        if (!enabled) {
            throw new IllegalStateException("The DKG isn't enabled on this server.");
        }
        String sparql = "SELECT ?f WHERE { GRAPH ?g { <" + ReadingAsset.subject(reading) + "> <"
                + ReadingAsset.NS + "fingerprint> ?f } } LIMIT 1";
        Path rq = temp(".rq", sparql);
        try {
            String output = runner.apply(List.of(cli, "query", contextGraph, "--include-shared-memory", "-f", rq.toString()));
            return output.contains(reading.getFingerprint());
        } finally {
            delete(rq);
        }
    }

    private String run(List<String> command) {
        List<String> full = new ArrayList<>();
        if (System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win")) {
            full.add("cmd"); // dkg is an npm script, which Windows starts through cmd
            full.add("/c");
        }
        full.addAll(command);
        try {
            Process process = new ProcessBuilder(full).redirectErrorStream(true).start();
            String output;
            try (InputStream in = process.getInputStream()) {
                output = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("The DKG node took too long to answer.");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("The DKG node said: " + tail(output));
            }
            return output;
        } catch (IOException e) {
            throw new IllegalStateException("Couldn't run the dkg tool. Is the node installed and started?", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while talking to the DKG node.", e);
        }
    }

    private static Path temp(String suffix, String content) {
        try {
            Path file = Files.createTempFile("slackwater-dkg-", suffix);
            Files.writeString(file, content, StandardCharsets.UTF_8);
            return file;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void delete(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // a leftover temp file is harmless
        }
    }

    private static String tail(String output) {
        String clean = output.lines().filter(l -> !l.contains("Warning") && !l.contains("trace-warnings"))
                .reduce("", (a, b) -> a + b + "\n").strip();
        return clean.length() <= 400 ? clean : clean.substring(clean.length() - 400);
    }
}
