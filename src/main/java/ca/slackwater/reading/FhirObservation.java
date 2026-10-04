package ca.slackwater.reading;

import ca.slackwater.analysis.Verdict;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A reading as a FHIR R4 Observation, following the OneAquaHealth implementation guide's
 * ObservationIndicatorsOah profile (github.com/hl7-eu/oah, input/fsh/profiles/observation-indicators-oah.fsh):
 * status final, a code from the guide (#hydrology, "flow type, diversity of flow types..."), a subject that is a
 * LocationOah, an effective time, a performer, and a value that is a Quantity or a CodeableConcept.
 * A refusal has no value; it carries dataAbsentReason and the reason in words, as FHIR intends.
 *
 * The location and the device are contained in the Observation, so the export stands on its own.
 */
final class FhirObservation {

    static final String PROFILE = "http://hl7.eu/fhir/ig/oah/StructureDefinition/observation-indicators-oah";
    static final String LOCATION_PROFILE = "http://hl7.eu/fhir/ig/oah/StructureDefinition/location-oah";
    static final String OAH_CODES = "http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu";
    static final String UCUM = "http://unitsofmeasure.org";
    static final String DATA_ABSENT = "http://terminology.hl7.org/CodeSystem/data-absent-reason";
    // Our own identifiers and codes, clearly ours rather than borrowed.
    static final String FINGERPRINT_SYSTEM = "urn:slackwater:fingerprint";
    static final String SITE_SYSTEM = "urn:slackwater:site";
    static final String FLOW_STATE_SYSTEM = "urn:slackwater:flow-state";
    static final String APP_FLOW_SYSTEM = "urn:oneaquahealth:citizen-app:water-flow";
    static final String DKG_SYSTEM = "urn:origintrail:dkg";

    private FhirObservation() {
    }

    static Map<String, Object> of(Reading r) {
        Map<String, Object> obs = new LinkedHashMap<>();
        obs.put("resourceType", "Observation");
        obs.put("id", "slackwater-" + r.getId());
        obs.put("meta", Map.of("profile", List.of(PROFILE)));
        obs.put("contained", List.of(location(r), device(r)));
        List<Map<String, Object>> identifiers = new ArrayList<>();
        identifiers.add(Map.of("system", FINGERPRINT_SYSTEM, "value", r.getFingerprint()));
        if (r.getAnchor() != null) {
            // Where the same reading sits on the OriginTrail DKG: the on-chain UAL if published, else its locator.
            identifiers.add(Map.of("system", DKG_SYSTEM,
                    "value", r.getAnchor().onChain() ? r.getAnchor().ual() : r.getAnchor().locator()));
        }
        obs.put("identifier", identifiers);
        obs.put("status", "final");
        obs.put("code", Map.of(
                "coding", List.of(Map.of("system", OAH_CODES, "code", "hydrology", "display", "Hydrology of the stream")),
                "text", "Surface flow measured from video"));
        obs.put("subject", Map.of("reference", "#site"));
        obs.put("effectiveDateTime", r.getCreatedAt().toString());
        obs.put("performer", List.of(Map.of("display", "SlackWater engine " + r.getEngineVersion())));

        if (r.getVerdict() == Verdict.MOVING && r.getSurfaceSpeedMetresPerSec() != null) {
            obs.put("valueQuantity", quantity(r.getSurfaceSpeedMetresPerSec(), "m/s", "m/s"));
        } else if (r.getVerdict() == Verdict.MOVING || r.getVerdict() == Verdict.STILL) {
            String code = r.getVerdict() == Verdict.MOVING ? "moving" : "still";
            obs.put("valueCodeableConcept", Map.of(
                    "coding", List.of(Map.of("system", FLOW_STATE_SYSTEM, "code", code,
                            "display", r.getVerdict() == Verdict.MOVING ? "Moving" : "Still")),
                    "text", r.getReason()));
        } else {
            obs.put("dataAbsentReason", Map.of(
                    "coding", List.of(Map.of("system", DATA_ABSENT, "code", "unknown", "display", "Unknown")),
                    "text", "Refused (" + r.getRefusal() + "): " + r.getReason()));
        }

        obs.put("note", notes(r));
        obs.put("method", Map.of("text", "Video surface-velocity analysis: Good Features To Track and Kanade-Lucas-Tomasi "
                + "optical flow, the camera checked against fixed points on the banks, and refusal gates. "
                + "Settings: " + r.getSettings()));
        obs.put("device", Map.of("reference", "#engine"));
        List<Map<String, Object>> components = components(r);
        if (!components.isEmpty()) {
            obs.put("component", components);
        }
        return obs;
    }

    private static Map<String, Object> location(Reading r) {
        Map<String, Object> loc = new LinkedHashMap<>();
        String name = r.getSiteName() == null || r.getSiteName().isBlank() ? "Unnamed site" : r.getSiteName();
        loc.put("resourceType", "Location");
        loc.put("id", "site");
        loc.put("meta", Map.of("profile", List.of(LOCATION_PROFILE)));
        loc.put("identifier", List.of(Map.of("system", SITE_SYSTEM, "value", slug(name))));
        loc.put("name", name);
        loc.put("mode", "instance");
        if (r.getLatitude() != null && r.getLongitude() != null) {
            loc.put("position", Map.of("latitude", r.getLatitude(), "longitude", r.getLongitude()));
        }
        return loc;
    }

    private static Map<String, Object> device(Reading r) {
        Map<String, Object> dev = new LinkedHashMap<>();
        dev.put("resourceType", "Device");
        dev.put("id", "engine");
        dev.put("deviceName", List.of(Map.of("name", "SlackWater " + r.getEngineVersion(), "type", "model-name")));
        dev.put("type", Map.of("text", "Video surface-velocity analysis software"));
        return dev;
    }

    private static List<Map<String, Object>> notes(Reading r) {
        List<Map<String, Object>> notes = new ArrayList<>();
        notes.add(Map.of("text", r.getReason()));
        if (r.getNote() != null) {
            notes.add(Map.of("text", r.getNote()));
        }
        AppFlowAnswer answer = r.getAppFlowAnswer();
        notes.add(Map.of("text", "OneAquaHealth app answer: " + (answer.code() == null ? "none" : answer.code() + " "
                + answer.label()) + ". " + answer.why()));
        return notes;
    }

    private static List<Map<String, Object>> components(Reading r) {
        List<Map<String, Object>> list = new ArrayList<>();
        add(list, "Surface speed in the video's pixels per second", r.getSurfaceSpeedPxPerSec(), "px/s", null);
        add(list, "Flow direction in the frame (0 = right, 90 = up)", r.getDirectionDegrees(), "deg", "deg");
        add(list, "Share of tracked points moving", r.getMovingShare() == null ? null : 100 * r.getMovingShare(), "%", "%");
        add(list, "Direction coherence (1 = all points agree)", r.getDirectionCoherence(), "1", "1");
        add(list, "Share of frame pairs where the camera moved",
                r.getCameraUnstableShare() == null ? null : 100 * r.getCameraUnstableShare(), "%", "%");
        AppFlowAnswer answer = r.getAppFlowAnswer();
        if (answer.code() != null) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("code", Map.of("text", "OneAquaHealth citizen app water-flow answer"));
            c.put("valueCodeableConcept", Map.of(
                    "coding", List.of(Map.of("system", APP_FLOW_SYSTEM, "code", answer.code(), "display", answer.label())),
                    "text", answer.why()));
            list.add(c);
        }
        return list;
    }

    private static void add(List<Map<String, Object>> list, String text, Double value, String unit, String ucum) {
        if (value == null) {
            return;
        }
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("code", Map.of("text", text));
        c.put("valueQuantity", ucum == null
                ? Map.of("value", round(value), "unit", unit)
                : quantity(value, unit, ucum));
        list.add(c);
    }

    private static Map<String, Object> quantity(double value, String unit, String ucum) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("value", round(value));
        q.put("unit", unit);
        q.put("system", UCUM);
        q.put("code", ucum);
        return q;
    }

    private static double round(double value) {
        return Math.round(value * 1000) / 1000.0;
    }

    private static String slug(String name) {
        String s = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        return s.isEmpty() ? "site" : s;
    }
}
