package ca.slackwater.reading;

import org.junit.jupiter.api.Test;

import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Starts the app the way it runs live: seeding on, so the three Geul readings (and Trinidad's nine labelled clips) are there from the start. */
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
                .andExpect(jsonPath("$.length()").value(12))
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

    @Test
    void readingsExportAsFhirObservationsInTheOneAquaHealthProfile() throws Exception {
        List<Reading> readings = repository.findAllByOrderByCreatedAtDesc();
        Reading topDown = readings.get(1);   // MOVING with a scale: a quantity in m/s
        Reading camera = readings.get(0);    // MOVING without a scale: a code
        Reading refused = readings.get(2);   // REFUSED: no value, a reason instead

        mvc.perform(get("/api/readings/" + topDown.getId() + "/fhir"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/fhir+json"))
                .andExpect(jsonPath("$.resourceType").value("Observation"))
                .andExpect(jsonPath("$.meta.profile[0]").value(FhirObservation.PROFILE))
                .andExpect(jsonPath("$.status").value("final"))
                .andExpect(jsonPath("$.code.coding[0].system").value(FhirObservation.OAH_CODES))
                .andExpect(jsonPath("$.code.coding[0].code").value("hydrology"))
                .andExpect(jsonPath("$.subject.reference").value("#site"))
                .andExpect(jsonPath("$.contained[0].resourceType").value("Location"))
                .andExpect(jsonPath("$.contained[0].identifier[0].value").isString())
                .andExpect(jsonPath("$.contained[0].name").isString())
                .andExpect(jsonPath("$.contained[0].mode").value("instance"))
                .andExpect(jsonPath("$.effectiveDateTime").isString())
                .andExpect(jsonPath("$.performer[0].display").isString())
                .andExpect(jsonPath("$.identifier[0].value").value(topDown.getFingerprint()))
                .andExpect(jsonPath("$.valueQuantity.code").value("m/s"))
                .andExpect(jsonPath("$.valueQuantity.system").value(FhirObservation.UCUM))
                .andExpect(jsonPath("$.dataAbsentReason").doesNotExist());

        mvc.perform(get("/api/readings/" + camera.getId() + "/fhir"))
                .andExpect(jsonPath("$.valueCodeableConcept.coding[0].code").value("moving"))
                .andExpect(jsonPath("$.valueQuantity").doesNotExist());

        mvc.perform(get("/api/readings/" + refused.getId() + "/fhir"))
                .andExpect(jsonPath("$.dataAbsentReason.coding[0].code").value("unknown"))
                .andExpect(jsonPath("$.dataAbsentReason.text").value(org.hamcrest.Matchers.containsString("BACKGROUND_MOVING")))
                .andExpect(jsonPath("$.valueQuantity").doesNotExist())
                .andExpect(jsonPath("$.valueCodeableConcept").doesNotExist());
    }

    @Test
    void readingsCarryTheAppsOwnFlowAnswer() throws Exception {
        mvc.perform(get("/api/readings"))
                .andExpect(jsonPath("$[1].appFlowAnswer.code").value("FAS"))
                .andExpect(jsonPath("$[0].appFlowAnswer.code").doesNotExist());
    }
}
