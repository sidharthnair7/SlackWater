package ca.slackwater;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "slackwater.seed.enabled=false")
class SlackWaterApplicationTests {

    @Test
    void contextLoads() {
    }

}
