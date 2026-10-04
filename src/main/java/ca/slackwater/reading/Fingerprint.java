package ca.slackwater.reading;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * SHA-256 hashing. Change one byte of the video, or one setting, and the fingerprint changes completely,
 * so anyone holding the same clip and settings can check a reading was not edited.
 */
public final class Fingerprint {

    private Fingerprint() {
    }

    public static String ofFile(Path file) throws IOException {
        MessageDigest digest = sha256();
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    /** The reading's fingerprint: the video's hash, the settings and the engine version, hashed together. */
    public static String ofReading(String videoSha256, String settings, String engineVersion) {
        String joined = videoSha256 + "\n" + settings + "\n" + engineVersion;
        return HexFormat.of().formatHex(sha256().digest(joined.getBytes(StandardCharsets.UTF_8)));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Every Java runtime ships SHA-256", e);
        }
    }
}
