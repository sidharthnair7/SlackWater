package ca.slackwater.ledger;

/**
 * Where a reading was anchored on the DKG.
 *
 * @param fingerprint the reading's fingerprint (the same clip and settings always give the same one)
 * @param locator     its Shared Working Memory locator, written by this app (no gas)
 * @param ual         its on-chain UAL once published to Verifiable Memory (did:dkg:base:84532/...), or empty
 * @param tx          the Base Sepolia transaction for that publish, or empty
 * @param anchoredAt  when it was shared
 */
public record Anchor(String fingerprint, String locator, String ual, String tx, String anchoredAt) {

    public boolean onChain() {
        return ual != null && !ual.isBlank();
    }
}
