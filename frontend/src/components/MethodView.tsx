export function MethodView() {
  return (
    <section className="view">
      <div className="page-head">
        <h1>How it decides</h1>
        <p>
          SlackWater only answers when the clip proves it. Every rule below is fixed for engine 0.2.0, and the version
          is part of every reading's fingerprint.
        </p>
      </div>

      <div className="method">
        <ol className="steps">
          <li><h3>Draw the water box</h3><p>Everything outside it counts as fixed background: banks, rocks, walls.</p></li>
          <li><h3>Pair frames 0.1 s apart</h3><p>Times come from the video's own timestamps, because phones record at a variable frame rate.</p></li>
          <li><h3>Find points and follow them</h3><p>Corner-like spots (foam, leaves, ripples) are followed into the next frame, then back again. A point that doesn't return within 0.5 px is dropped.</p></li>
          <li><h3>Check the camera against the banks</h3><p>The banks should not move. If they shift by more than 0.8 px, that pair is thrown out. Small shifts are subtracted from the water.</p></li>
          <li><h3>Run the gates</h3><p>The first gate that fails becomes the refusal, in words the person filming can act on.</p></li>
          <li><h3>Decide still or moving</h3><p>Moving means at least a quarter of the points beat both 3 px/s and three times the banks' own jitter, all in one direction.</p></li>
          <li><h3>Save it with a fingerprint</h3><p>SHA-256 of the clip, the settings and the engine version. The clip itself is deleted; the hash proves which clip it was.</p></li>
        </ol>

        <div className="method-side">
          <h2 className="block-title">Gate thresholds, engine 0.2.0</h2>
          <div className="table-wrap">
            <table className="thresholds">
              <thead><tr><th scope="col">Gate</th><th scope="col">Refuses when</th></tr></thead>
              <tbody>
                <tr><td>Enough video</td><td className="data">&lt; 1 s or &lt; 5 pairs</td></tr>
                <tr><td>Fixed background in view</td><td className="data">&lt; 12 bank points</td></tr>
                <tr><td>Camera held still</td><td className="data">&gt; 25% of pairs moved</td></tr>
                <tr><td>Background still</td><td className="data">bank jitter &gt; 15 px/s at 640 wide</td></tr>
                <tr><td>Something to follow</td><td className="data">&lt; 15 water points</td></tr>
                <tr><td>One direction</td><td className="data">coherence &lt; 0.60</td></tr>
              </tbody>
            </table>
          </div>

          <h2 className="block-title">What it never claims</h2>
          <ul className="never">
            <li>River speed. It measures the surface, which flows faster than the average.</li>
            <li>Metres per second without a scale in the frame.</li>
            <li>Mosquitoes, larvae or disease. It says still or moving; crews decide where to look.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
