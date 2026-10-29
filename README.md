# ICSE Class 10 MCQ Practice

A static practice site for ICSE Class 10 multiple-choice questions, covering seven live subjects: History & Civics, Economics, Geography, Maths, English Literature, Physics, and Physical Education. Chemistry and Computer Applications have placeholder pages and are next in line. Pick a session length, answer one question at a time, and see explanations at the end. Progress is stored in the browser with `localStorage`; there is no login. The optional next-subject poll uses a small Vercel function with free Upstash Redis; without it, the poll falls back to local-only voting.

Built with Astro, Svelte, Tailwind CSS, and TypeScript. The production build is a plain static site in `dist/`.

> **Placeholder content:** each subject currently contains five questions marked `PLACEHOLDER:`. They exist so the app and validator work end-to-end. They are **not** real board questions. Replace them with checked content before publishing.

## Requirements

- Node.js **22.23 or newer** (Node 24 LTS recommended)
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Astro (usually <http://localhost:4321>).

To build and preview the production output:

```bash
npm run build
npx astro preview
```

The build output is written to `dist/`.

## Subjects and data files

| Subject slug | Title              | Data file                      | ID prefix |
| ------------ | ------------------ | ------------------------------ | --------- |
| `history`    | History & Civics   | `src/data/history.json`        | `hist`    |
| `economics`  | Economics          | `src/data/economics.json`      | `eco`     |
| `geography`  | Geography          | `src/data/geography.json`      | `geo`     |
| `maths`      | Maths              | `src/data/maths.json`          | `math`    |
| `english-lit`| English Literature | `src/data/english-lit.json`    | `lit`     |
| `physics`    | Physics            | `src/data/physics.json`        | `phy`     |
| `chemistry`  | Chemistry (coming soon) | `src/data/chemistry.json` | `chem`    |
| `computer-applications` | Computer Applications (coming soon) | `src/data/computer-applications.json` | `comp` |
| `physical-education` | Physical Education | `src/data/physical-education.json` | `pe` |

Each file is a JSON array of question objects. Keep it valid JSON: no comments and no trailing commas.

## Next-subject poll

The `/poll` page asks visitors which subject to add next. Options and ids live in `src/lib/poll.ts`, and the home page and footer link to the page. Visitors can change or remove their vote.

The poll works in two modes:

| Mode | When | Behaviour |
| --- | --- | --- |
| Shared | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set | Votes go through the Vercel function in `api/poll.ts`, totals are shared by all visitors, and results appear after voting. |
| Local | The function is not configured or unreachable | The vote stays in `localStorage` (`icse:poll-next-subject`) on that device. No totals are shown. |

The shared mode uses an anonymous, `HttpOnly` cookie to count one vote per browser. No IP addresses or personal data are stored; Redis only holds the option counters and a random vote token. Changing a vote moves the count from the old option to the new one, and removing it decrements the count.

### Free setup on Vercel

Vercel Hobby and Upstash Redis both have free tiers (Upstash: 256 MB and 500,000 commands per month), which is plenty for this poll.

1. In the Vercel dashboard, open **Storage** (Marketplace) and add **Upstash for Redis**, choosing the free plan. Connect it to this project.
2. Make sure the project has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for Production, Preview, and Development. The older `KV_REST_API_URL` / `KV_REST_API_TOKEN` names are also supported.
3. Redeploy the project. The poll switches to shared mode automatically.

For local testing with the API function:

```bash
npx vercel link
npx vercel env pull .env.local
npx vercel dev
```

`npm run dev` serves the Astro site only, so `/api/poll` is unavailable there and the poll uses local mode. `.env.example` lists the variable names; never commit `.env.local`.

Editing `POLL_OPTIONS` is enough to change the list. Never reuse an id for a different subject because existing votes are matched by id.

## Adding questions

1. Open the JSON file for the subject.
2. Add one object to the array, using the schema below.
3. Give it a unique ID with the subject prefix, for example `hist-006`.
4. Keep `verified` as `false` until a person has checked the question, answer, and explanation.
5. Run `npm run validate` and fix any errors.
6. Run the app with `npm run dev` and try the question.

### Question schema

| Field         | Type       | Required | Rules |
| ------------- | ---------- | -------- | ----- |
| `id`          | `string`   | yes      | Non-empty and unique across all five data files. Use the subject prefix. |
| `question`    | `string`   | yes      | Non-empty. Must be unique after ignoring case, whitespace, and punctuation. |
| `options`     | `string[]` | yes      | Exactly 4 non-empty strings. Options within one question must be unique after normalisation. |
| `answer`      | `number`   | yes      | Integer index into `options`, from `0` to `3`. |
| `explanation` | `string`   | yes      | Non-empty. Shown after answering. |
| `verified`    | `boolean`  | yes      | `true` only after the content has been checked. |
| `source`      | `string`   | no       | Internal note about where the question came from. Never rendered in the UI. |

Do **not** add fields named `year` or `paper`, at any nesting level. The validator rejects them so exam year/paper information cannot leak into the UI.

### Example question

```json
{
  "id": "hist-006",
  "question": "Replace this with the question text.",
  "options": [
    "First option",
    "Second option",
    "Third option",
    "Fourth option"
  ],
  "answer": 2,
  "explanation": "Explain briefly why the third option is correct.",
  "verified": false,
  "source": "internal reference, if useful"
}
```

`answer` is zero-based, so `"answer": 2` means the third option is correct.

## Validation

```bash
npm run validate
```

The validator (`scripts/validate.ts`, run with `tsx`) checks every data file and exits with a non-zero status if it finds:

- invalid JSON
- a missing required field, or a field of the wrong type
- an `options` array that does not contain exactly 4 non-empty strings
- answers that are not integers between 0 and 3
- duplicate options inside one question (case/whitespace/punctuation ignored)
- duplicate IDs anywhere in the data set
- exact duplicate questions after normalising case, whitespace, and punctuation
- any field named `year` or `paper`

It prints a per-subject question count and a `PASS`/`FAIL` summary.

Near-duplicate questions are reported as **warnings**, not failures. Similarity uses a dependency-free Jaccard comparison of normalised words. Any pair scoring above `0.90` is written to `dupes-report.txt` in the project root so you can review it. The report is generated output and should not be committed.

Typical output:

```text
Question counts by subject:
  History & Civics    5
  Economics           5
  Geography           5
  Maths               5
  English Literature  5
  TOTAL               25

PASS: 25 question(s) are valid.
Near-duplicates: none (report: dupes-report.txt).
```

## Tests

```bash
npm test
```

To run only the validator tests:

```bash
npx vitest run scripts/validate.test.ts
```

The tests cover every validation rule, the near-duplicate report, report formatting, and the shipped placeholder files.

## Deploy

Run `npm run build` first if you want to check the output locally. All three hosts below serve the static `dist/` directory; no runtime environment variables or server code are required.

### Netlify

1. Push the repository to GitHub, GitLab, or Bitbucket and import it in Netlify.
2. Set **Build command** to `npm run build`.
3. Set **Publish directory** to `dist`.
4. Set the build environment variable `NODE_VERSION=22` if Netlify's default Node version is older than 22.23.
5. Deploy.

Equivalent `netlify.toml` settings:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "22"
```

### Vercel

1. Import the repository in Vercel.
2. Choose the **Astro** framework preset (or set the build command to `npm run build`).
3. Set the **Output Directory** to `dist`.
4. Select Node.js 22.x or newer in the project settings.
5. Deploy.

From the command line:

```bash
npm install -g vercel
vercel
vercel --prod
```

### GitHub Pages

GitHub Pages needs two things that other hosts do not: a `base` path for project pages, and a workflow that publishes the build.

1. In `astro.config.mjs`, set `site` and (for a project page) `base`:

   ```js
   export default defineConfig({
     site: 'https://YOUR_USERNAME.github.io',
     base: '/YOUR_REPOSITORY/',
     // ...existing integrations and vite config
   });
   ```

   Use `base: '/'` for a user/organisation page or a custom domain. The `base` value must match the URL path or assets will 404.

2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.

3. Add `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy to GitHub Pages

   on:
     push:
       branches: [main]
     workflow_dispatch:

   permissions:
     contents: read
     pages: write
     id-token: write

   concurrency:
     group: pages
     cancel-in-progress: true

   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: npm
         - run: npm ci
         - run: npm run build
         - uses: actions/upload-pages-artifact@v3
           with:
             path: dist

     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

4. Push to `main`. The workflow builds the site and publishes `dist/`.

If you deploy from a `gh-pages` branch instead of Actions, add an empty `.nojekyll` file to the published output so GitHub Pages does not ignore Astro's `_astro/` directory.

## Gamification

Progress is stored locally under `icse:game:v1`. It is separate from seen questions and accuracy, so resetting seen questions never clears XP, levels, streaks or badges. Use **Reset game progress** on the home page to clear game state only.

| Rule | Value |
| --- | --- |
| Correct answer | 10 XP |
| Combo | x1 for 1-2 in a row, x1.5 from 3, x2 from 6 (cap x2) |
| Missed-question bonus | +5 XP the first time you get a previously missed question right |
| Wrong answer | 0 XP (never negative) |
| Session completion | +20 XP |
| Level | `floor(sqrt(xp / 50)) + 1` |
| Streak | Counts a day when you complete a session or hit your daily goal |
| Streak gap | One missed day is free; longer gaps spend one freeze per missed day |
| Freezes | Earn one every 7 streak days, maximum 2 |
| Daily goal | 10, 20 or 30 answers, chosen on the home page |

## Question ids and the ids snapshot

Question `id`s are the keys for seen and mastery progress. Never rename or remove one. `npm run validate` fails if any id in `scripts/ids.snapshot.json` disappears, and warns (without failing) when an id does not look like `prefix-001`. When you add questions, append new ids and refresh the snapshot after reviewing the diff:

```bash
npm run validate
```

## Before going live

- Replace all 25 `PLACEHOLDER:` questions with reviewed content.
- Set `verified` to `true` only for questions you have checked.
- Run `npm run validate`, `npm test`, and `npm run build`.
- Check a deployed preview on a phone, since the site is designed for quick practice sessions.
