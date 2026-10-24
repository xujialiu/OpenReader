# TestFlight badge and README installation badges

Read when checking the public TestFlight link's build, diagnosing a stale
badge, or changing README installation badges. For credentials, read
[App Store Connect API access](app-store-connect.md#testflight-and-api-access).

README.md says which build people can install (MEMORY/documentation.md,
"README.md").

- **The TestFlight badge follows by itself** (#150). It names the build the TestFlight Beta's public link installs: the highest Build Number in the group `public` that App Store Connect lists as Testing. No commit names a build.
  - `scripts/testflight-badge.mjs` asks the App Store Connect API. `.github/workflows/pages.yml` runs it every hour and publishes the answer as `testflight.json` on the project's site, and the badge reads that file through shields.io. An hourly run deploys only when the answer has changed.
  - So the badge is up to an hour behind App Store Connect, and then as long again as shields.io and GitHub cache the image.
  - To read the build now:

    ```bash
    node --env-file="$HOME/.secrets/openreader/app-store-connect-api.env" scripts/testflight-badge.mjs
    ```

  - To make the badge follow now: `gh workflow run pages.yml`.
  - It reads `none` when no build in `public` is in testing, or the public link is off.
  - If App Store Connect cannot be read, the run fails and GitHub mails the owner. The badge keeps the last build, and a push still publishes the site.
  - GitHub stops a scheduled workflow after 60 days without activity in the repository. Turn it on again under Actions → Pages.
- **When a Version goes live on the App Store:**
  - Add Apple's "Download on the App Store" badge to README.md, linking to https://apps.apple.com/app/id6817809106. Add both addresses to `PAGES_MAY_NAME`.
  - The TestFlight badge stays beside it.
  - Run `bash scripts/readme-preview.sh` and give the owner `.docs/README.html` to look at before committing.

