package ca.slackwater.reading;

import ca.slackwater.analysis.Verdict;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AppFlowAnswerTest {

    @Test
    void stillWaterIsStagnant() {
        assertThat(AppFlowAnswer.of(Verdict.STILL, null).code()).isEqualTo("STA");
    }

    @Test
    void movingWaterWithAScaleIsSlowOrFastAtTheCutOff() {
        assertThat(AppFlowAnswer.of(Verdict.MOVING, 0.3).code()).isEqualTo("NOR");
        assertThat(AppFlowAnswer.of(Verdict.MOVING, 0.5).code()).isEqualTo("FAS");
        assertThat(AppFlowAnswer.of(Verdict.MOVING, 1.59).code()).isEqualTo("FAS");
    }

    @Test
    void movingWithoutAScaleCannotChooseAndSaysWhy() {
        AppFlowAnswer answer = AppFlowAnswer.of(Verdict.MOVING, null);

        assertThat(answer.code()).isNull();
        assertThat(answer.why()).contains("without a scale");
    }

    @Test
    void aRefusalHasNoAnswer() {
        assertThat(AppFlowAnswer.of(Verdict.REFUSED, null).code()).isNull();
    }
}
