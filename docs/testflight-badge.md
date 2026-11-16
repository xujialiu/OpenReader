# TestFlight badge and README installation badges

Read when checking the public TestFlight link's build, diagnosing a stale
build feed, or changing README installation badges. For credentials, read
[App Store Connect API access](app-store-connect.md#testflight-and-api-access).

The README's App Store and TestFlight download buttons sit side by side at
120 × 40 pixels. The TestFlight button is the animated SVG in
`assets/readme/testflight.svg`, from
[Lex Tang's gist](https://gist.github.com/lexrus/eadc04582835d9f16ea4d4448d0e8b2c).
The author permits any use without attribution. Its viewport, continuous corner
contours and gray border match the App Store button's; its icon column, text
sizes and baselines follow the same layout. The blue gradient, square grid and
1.55-second propeller animation are retained. The artwork and lettering scale
uniformly. The source, revision and border source are in the SVG's comment.

- **The TestFlight build feed follows by itself** (#150). It names the build the TestFlight Beta's public link installs: the highest Build Number in the group `public` that App Store Connect lists as Testing. The download button carries no build number.
  - `scripts/testflight-badge.mjs` asks the App Store Connect API. `.github/workflows/pages.yml` runs it every hour and publishes the answer as `testflight.json` on the project's site. The feed keeps the Shields endpoint format for diagnostics; the README uses the download button above. An hourly run deploys only when the answer has changed.
  - The published feed can be up to an hour behind App Store Connect.
  - To read the build now:

    ```bash
    node --env-file="$HOME/.secrets/openreader/app-store-connect-api.env" scripts/testflight-badge.mjs
    ```

  - To refresh the published feed now: `gh workflow run pages.yml`.
  - It reads `none` when no build in `public` is in testing, or the public link is off.
  - If App Store Connect cannot be read, the run fails and GitHub mails the owner. The feed keeps the last build, and a push still publishes the site.
  - GitHub stops a scheduled workflow after 60 days without activity in the repository. Turn it on again under Actions → Pages.
- **When changing installation badges:** keep the two buttons together at the same size, with the App Store button linking to https://apps.apple.com/app/id6817809106 and TestFlight to https://testflight.apple.com/join/vjC8QejW. Every absolute README address belongs on `PAGES_MAY_NAME`.
  - Run `bash scripts/readme-preview.sh` and give the owner `.docs/README.html` to look at before committing.

