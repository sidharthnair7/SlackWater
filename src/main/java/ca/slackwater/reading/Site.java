package ca.slackwater.reading;

/** Where the clip was filmed. Every part is optional: a clip without a place can still be measured. */
public record Site(String name, Double latitude, Double longitude) {
}
