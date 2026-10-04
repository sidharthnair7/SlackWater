package ca.slackwater.analysis;

public enum Verdict {
    /** Things on the surface were visible and stayed put. */
    STILL,
    /** Things on the surface moved together in one direction, faster than the noise. */
    MOVING,
    /** A gate failed, so we say why instead of guessing. */
    REFUSED
}
