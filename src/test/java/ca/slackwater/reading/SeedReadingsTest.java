package ca.slackwater.reading;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Starts the app the way it runs live: seeding on, so the three Geul readings are there from the start. */
@SpringBootTest
@AutoConfigureMockMvc
class SeedReadingsTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ReadingRepository repository;

    @Test
    void theLiveSiteStartsWithRealReadings() throws Exception {
        mvc.perform(get("/api/readings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].verdict").value("MOVING"))
                .andExpect(jsonPath("$[0].clipPath").value("geul/20241010_081717.mp4"))
                .andExpect(jsonPath("$[0].evidenceAvailable").value(true))
                .andExpect(jsonPath("$[0].evidencePng").doesNotExist())
                .andExpect(jsonPath("$[1].surfaceSpeedMetresPerSec").isNumber())
                .andExpect(jsonPath("$[2].refusal").value("BACKGROUND_MOVING"));

        long first = repository.findAllByOrderByCreatedAtDesc().getFirst().getId();
        mvc.perform(get("/api/readings/" + first + "/evidence.png"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"));
        mvc.perform(get("/api/readings/" + first + "/overlay.png"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"));
        mvc.perform(get("/clips/geul/20241010_081717.mp4"))
                .andExpect(status().isOk());
    }
}
