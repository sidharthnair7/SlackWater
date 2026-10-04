package ca.slackwater.reading;

import ca.slackwater.analysis.ClipFiles;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "slackwater.seed.enabled=false")
@AutoConfigureMockMvc
class ReadingControllerTest {

    @Autowired
    MockMvc mvc;

    @TempDir
    Path dir;

    private MockMultipartFile clip() throws Exception {
        return new MockMultipartFile("video", "flowing.mkv", "video/x-matroska",
                Files.readAllBytes(ClipFiles.writeFlowingClip(dir)));
    }

    private MvcResult upload(MockMultipartFile video, String regionHeight) throws Exception {
        return mvc.perform(multipart("/api/readings").file(video)
                        .param("regionX", "0").param("regionY", "0.3333")
                        .param("regionWidth", "1").param("regionHeight", regionHeight)
                        .param("metresPerPixel", "0.01")
                        .param("siteName", "Test strip"))
                .andReturn();
    }

    @Test
    void uploadMeasuresSavesAndFingerprints() throws Exception {
        MockMultipartFile video = clip();

        mvc.perform(multipart("/api/readings").file(video)
                        .param("regionX", "0").param("regionY", "0.3333")
                        .param("regionWidth", "1").param("regionHeight", "0.3333")
                        .param("metresPerPixel", "0.01")
                        .param("siteName", "Test strip"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.verdict").value("MOVING"))
                .andExpect(jsonPath("$.siteName").value("Test strip"))
                .andExpect(jsonPath("$.engineVersion").value("0.2.0"))
                .andExpect(jsonPath("$.fingerprint").isString());

        mvc.perform(get("/api/readings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].verdict").exists());
    }

    @Test
    void everyReadingServesThePointsItFollowed() throws Exception {
        String body = upload(clip(), "0.3333").getResponse().getContentAsString();
        long id = Long.parseLong(body.replaceAll(".*\"id\":(\\d+).*", "$1"));

        mvc.perform(get("/api/readings/" + id + "/points"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdict").value("MOVING"))
                .andExpect(jsonPath("$.followed").isNumber())
                .andExpect(jsonPath("$.points.length()").value(org.hamcrest.Matchers.greaterThan(0)));
        assertThat(body).contains("\"pointsAvailable\":true");
    }

    @Test
    void sameClipAndSettingsGiveTheSameFingerprint() throws Exception {
        MockMultipartFile video = clip();
        String first = upload(video, "0.3333").getResponse().getContentAsString();
        String second = upload(video, "0.3333").getResponse().getContentAsString();
        String otherBox = upload(video, "0.3").getResponse().getContentAsString();

        assertThat(fingerprint(first)).isEqualTo(fingerprint(second));
        assertThat(fingerprint(first)).isNotEqualTo(fingerprint(otherBox));
    }

    @Test
    void aBoxOutsideTheFrameIsABadRequest() throws Exception {
        mvc.perform(multipart("/api/readings").file(clip())
                        .param("regionX", "0.9").param("regionY", "0")
                        .param("regionWidth", "0.5").param("regionHeight", "0.5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").isString());
    }

    @Test
    void somethingThatIsNotAVideoIsRefusedNotCrashed() throws Exception {
        MockMultipartFile notVideo = new MockMultipartFile("video", "notes.txt", "text/plain", "hello".getBytes());

        mvc.perform(multipart("/api/readings").file(notVideo)
                        .param("regionX", "0").param("regionY", "0.3333")
                        .param("regionWidth", "1").param("regionHeight", "0.3333"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.verdict").value("REFUSED"))
                .andExpect(jsonPath("$.refusal").value("VIDEO_UNREADABLE"));
    }

    private static String fingerprint(String json) {
        int start = json.indexOf("\"fingerprint\":\"") + 15;
        return json.substring(start, start + 64);
    }
}
