package ca.slackwater.analysis;

/**
 * The box the user draws around the water, as fractions of the frame (0 to 1), so the same box
 * works at any resolution. Everything outside it is treated as fixed background: banks, rocks, walls.
 */
public record Region(double x, double y, double width, double height) {

    public Region {
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) {
            throw new IllegalArgumentException("The water box must sit inside the frame (values from 0 to 1).");
        }
        if (width < 0.05 || height < 0.05) {
            throw new IllegalArgumentException("The water box is too small. Draw it around more of the water.");
        }
    }
}
