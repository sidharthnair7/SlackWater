package ca.slackwater.ledger;

import ca.slackwater.analysis.AnalysisResult;
import ca.slackwater.analysis.GateValues;
import ca.slackwater.analysis.Verdict;
import ca.slackwater.reading.Reading;
import ca.slackwater.reading.ReadingFixtures;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The ledger with a stand-in for the dkg command, so these run without a node. */
class DkgLedgerTest {

    @TempDir
    Path dir;

    private final List<List<String>> calls = new ArrayList<>();

    private Reading reading() {
        AnalysisResult result = new AnalysisResult(Verdict.MOVING, null, "99% moved together.", null, 158.9, 1.589,
                3.9, GateValues.none(), null, null);
        return ReadingFixtures.reading(result, "Geul \"top-down\"", "a".repeat(64));
    }

    private DkgLedger ledger(boolean enabled, String output) {
        return new DkgLedger(enabled, "dkg", "0xabc/slackwater", 5, new AnchorStore(dir.toString()), command -> {
            calls.add(command);
            return output;
        });
    }

    @Test
    void anchoringSharesTheAssetAndRemembersTheLocator() {
        DkgLedger ledger = ledger(true, "Shared.\n  URI: did:dkg:context-graph:0xabc/slackwater/_working_memory/0xabc/7\n");

        Anchor anchor = ledger.anchor(reading());

        assertThat(anchor.locator()).isEqualTo("did:dkg:context-graph:0xabc/slackwater/_working_memory/0xabc/7");
        assertThat(calls.getFirst()).containsSequence("ka", "create").contains("--share", "-c", "0xabc/slackwater");
        assertThat(new AnchorStore(dir.toString()).find(reading().getFingerprint())).contains(anchor);
    }

    @Test
    void anchoringTheSameReadingTwiceDoesNotPublishTwice() {
        DkgLedger ledger = ledger(true, "did:dkg:context-graph:0xabc/slackwater/_working_memory/0xabc/7");
        ledger.anchor(reading());
        ledger.anchor(reading());

        assertThat(calls).hasSize(1);
    }

    @Test
    void verifyLooksForTheExactFingerprint() {
        // The fingerprint is SHA-256 of the video hash, the settings and the engine version, not the video hash.
        String fingerprint = reading().getFingerprint();
        assertThat(ledger(true, "f\n\"" + fingerprint + "\"").verify(reading())).isTrue();
        assertThat(ledger(true, "no results").verify(reading())).isFalse();
    }

    @Test
    void offByDefaultAndSaysWhy() {
        assertThatThrownBy(() -> ledger(false, "").anchor(reading()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("isn't enabled");
    }

    @Test
    void theAssetIsValidTurtleShapedAroundTheFingerprint() {
        Reading r = reading();
        String ttl = ReadingAsset.turtle(r);

        assertThat(ttl).contains("<urn:slackwater:reading:" + r.getFingerprint() + "> a sosa:Observation")
                .contains("sw:videoSha256 \"" + "a".repeat(64) + "\"")
                .contains("#hydrology>")
                .contains("sw:surfaceSpeedMetresPerSec \"1.5890\"^^xsd:decimal")
                .contains("schema:name \"Geul \\\"top-down\\\"\"") // quotes escaped
                .endsWith(" .\n");
    }
}
