package ca.slackwater.analysis;

/**
 * Receives every point the engine followed in a steady pair, for drawing them all at once (the 3D point field).
 * Positions are fractions of the frame, 0 to 1 from the top left. Velocities are in the source video's pixels per
 * second, with the camera's own shift removed, so a bank point's velocity is the noise the engine measures.
 */
public interface PointSink {

    PointSink NONE = new PointSink() {
    };

    default void water(int pair, double x, double y, double vx, double vy) {
    }

    default void bank(int pair, double x, double y, double vx, double vy) {
    }
}
