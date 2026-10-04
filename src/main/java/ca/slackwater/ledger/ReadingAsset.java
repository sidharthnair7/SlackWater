package ca.slackwater.ledger;

import ca.slackwater.reading.Reading;

import java.util.Locale;

/**
 * A reading as a Knowledge Asset for the OriginTrail DKG, written in RDF (Turtle). It uses the W3C SOSA vocabulary
 * for observations, points its observed property at the OneAquaHealth guide's #hydrology code, and carries the
 * fingerprint, so anyone can check a reading against the public record without trusting this server.
 */
public final class ReadingAsset {

    public static final String NS = "https://slackwater.dev/ns#";
    public static final String SUBJECT_PREFIX = "urn:slackwater:reading:";
    static final String HYDROLOGY = "http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu#hydrology";

    private ReadingAsset() {
    }

    /** The asset's name on the node: short, stable, and the same every time for the same clip and settings. */
    public static String name(Reading r) {
        return "slackwater-reading-" + r.getFingerprint().substring(0, 16);
    }

    public static String subject(Reading r) {
        return SUBJECT_PREFIX + r.getFingerprint();
    }

    public static String turtle(Reading r) {
        StringBuilder t = new StringBuilder();
        t.append("@prefix sw: <").append(NS).append("> .\n");
        t.append("@prefix sosa: <http://www.w3.org/ns/sosa/> .\n");
        t.append("@prefix schema: <https://schema.org/> .\n");
        t.append("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n");
        t.append('<').append(subject(r)).append("> a sosa:Observation, sw:Reading ;\n");
        t.append("  sosa:observedProperty <").append(HYDROLOGY).append("> ;\n");
        t.append("  sosa:madeBySensor <urn:slackwater:engine:").append(r.getEngineVersion()).append("> ;\n");
        t.append("  sosa:resultTime \"").append(r.getCreatedAt()).append("\"^^xsd:dateTime ;\n");
        literal(t, "sw:fingerprint", r.getFingerprint());
        literal(t, "sw:videoSha256", r.getVideoSha256());
        literal(t, "sw:settings", r.getSettings());
        literal(t, "sw:engineVersion", r.getEngineVersion());
        literal(t, "sw:verdict", r.getVerdict().name());
        if (r.getRefusal() != null) {
            literal(t, "sw:refusal", r.getRefusal().name());
        }
        literal(t, "sw:reason", r.getReason());
        decimal(t, "sw:surfaceSpeedMetresPerSec", r.getSurfaceSpeedMetresPerSec());
        decimal(t, "sw:surfaceSpeedPxPerSec", r.getSurfaceSpeedPxPerSec());
        decimal(t, "sw:directionDegrees", r.getDirectionDegrees());
        decimal(t, "sw:movingShare", r.getMovingShare());
        decimal(t, "sw:directionCoherence", r.getDirectionCoherence());
        decimal(t, "sw:cameraUnstableShare", r.getCameraUnstableShare());
        if (r.getAppFlowAnswer().code() != null) {
            literal(t, "sw:appFlowAnswer", r.getAppFlowAnswer().code());
        }
        if (r.getSiteName() != null && !r.getSiteName().isBlank()) {
            literal(t, "schema:name", r.getSiteName());
        }
        t.append("  schema:isBasedOn \"SlackWater surface-flow engine\" .\n");
        return t.toString();
    }

    private static void literal(StringBuilder t, String predicate, String value) {
        if (value == null) {
            return;
        }
        String escaped = value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
        t.append("  ").append(predicate).append(" \"").append(escaped).append("\" ;\n");
    }

    private static void decimal(StringBuilder t, String predicate, Double value) {
        if (value == null) {
            return;
        }
        t.append("  ").append(predicate).append(" \"")
                .append(String.format(Locale.ROOT, "%.4f", value)).append("\"^^xsd:decimal ;\n");
    }
}
