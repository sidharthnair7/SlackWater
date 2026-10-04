package ca.slackwater.analysis;

/**
 * Every reason the tool can refuse, in the words a citizen or an inspector would see.
 */
public enum Refusal {
    VIDEO_UNREADABLE("We couldn't read this video file."),
    TOO_SHORT("The clip is too short to measure. We need at least one second of video."),
    NO_FIXED_BACKGROUND("We can't see enough of the bank or other fixed things outside the water box, "
            + "so we can't check whether the camera moved."),
    CAMERA_MOVED("The camera moved during the clip, so the motion we saw could be the camera and not the water. "
            + "Rest the phone on something and film again."),
    BACKGROUND_MOVING("Things outside the water box are moving, like more water or plants in the wind, "
            + "so we can't tell real motion from noise. Draw the box over all of the water."),
    NOTHING_TO_TRACK("There's nothing on the surface we can follow: no leaves, foam or ripples. "
            + "Clean, calm water can't be measured from video, so we won't guess. "
            + "Toss a leaf or small stick in upstream and film it floating past, from the bank."),
    MIXED_DIRECTIONS("The surface is moving in mixed directions. That's usually wind or reflections, "
            + "not the current, so we won't call it.");

    private final String message;

    Refusal(String message) {
        this.message = message;
    }

    public String message() {
        return message;
    }
}
