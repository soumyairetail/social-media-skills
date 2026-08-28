---
name: instagram-scout
description: >
  Search Instagram and scroll creator profiles to surface the videos that actually went viral, then rank them by how well they fit the user's upcoming events. Claude drives the browser through Explore, hashtag and keyword search, Reels tabs and individual profile grids, reads the real view counts, and scores each video as an outlier against that account's own baseline instead of trusting raw view numbers. Use this skill whenever the user says "search Instagram", "find viral videos", "find viral reels", "scroll this profile", "what's working on Instagram", "find reels for my event", "outlier reels", names an Instagram handle or hashtag and asks what is performing, or asks for video references tied to a launch, campaign, season or event they have coming up. Works with Claude for Chrome, Playwright MCP, or an APIFY_API_TOKEN.
---

# Instagram Scout

## CRITICAL: Auto-start on load

When this skill triggers, go straight to Step 1. Do not summarise the method first.

## Prerequisites

This skill needs live access to Instagram. Use this order of preference:

1. **Claude for Chrome extension** (preferred). Instagram gates most content behind a login wall, so a logged-in browser session sees far more than any anonymous fetch. Check the extension is enabled and Claude has permission to act on the current tab. If not, tell the user:
   > Enable the Claude for Chrome extension, open Instagram in a tab and make sure you are logged in. I need to drive the browser to search, scroll profiles and read view counts.
2. **Playwright MCP** with an existing logged-in profile, if Claude for Chrome is not available.
3. **Apify** as a data-only fallback, if `APIFY_API_TOKEN` is set. Use `apify/instagram-scraper` for profiles and hashtags and `apify/instagram-reel-scraper` for Reels. This returns metrics without visual scanning, so hooks and thumbnails cannot be assessed.

Pick the best available path and continue. If none are available, say exactly which one is missing and stop. Never guess at view counts.

## Step 1. Gather the search

Call AskUserQuestion:

```json
[
  {
    "question": "What should I search on Instagram?",
    "header": "Search",
    "multiSelect": true,
    "options": [
      {"label": "Specific accounts", "description": "I will paste handles to scroll profile by profile"},
      {"label": "Topic or keyword", "description": "Search Explore and keyword results across the whole platform"},
      {"label": "Hashtags", "description": "Scan hashtag pages for top and recent posts"},
      {"label": "Pull from about-me.md", "description": "Use the niche and audience already in my voice files"}
    ]
  },
  {
    "question": "How far back should I look?",
    "header": "Window",
    "multiSelect": false,
    "options": [
      {"label": "Last 30 days", "description": "Current formats, tighter pool"},
      {"label": "Last 90 days", "description": "Balanced. The default for most searches"},
      {"label": "Last 12 months", "description": "Includes last year's run-up to a seasonal event"},
      {"label": "All time", "description": "Best-ever performers regardless of date"}
    ]
  }
]
```

If the user picks "Pull from about-me.md", read the file from the project root. If it does not exist or names no clear niche, ask the user to type the niche.

Collect handles or keywords before browsing. Do not start scrolling on a vague brief.

## Step 2. Gather the upcoming events

This is what makes the results useful rather than a generic trending list. Ask:

> What have you got coming up over the next 90 days? Launches, campaigns, talks, seasonal moments, anything you need content for. One per line, with dates if you have them.

Before asking, check the project root for `events.md`, `calendar.md` or `content-calendar.md` and read any that exist. If one covers the next 90 days, show the user what you found and ask them to confirm or add to it rather than asking cold.

Build an internal event table with, for each event: name, date, audience, and the angle the user wants to hit. If the user gives no events, say you will rank on virality alone and skip the fit column in the output.

## Step 3. Browse like a researcher

Work through whichever of these apply to the search from Step 1. Record every candidate with its real numbers. Never estimate.

### 3a. Profile scrolling

For each handle:

1. Navigate to `https://www.instagram.com/[handle]/`.
2. Record the follower count and the total post count.
3. Open the Reels tab at `https://www.instagram.com/[handle]/reels/`. View counts are visible on the grid tiles here, which the main grid does not always show.
4. Scroll until you have at least 30 videos, or the account runs out.
5. Record for each: shortcode URL, view count, posted date, and the first line of the caption.
6. Open the top performers individually to read likes, comments and the full caption.

### 3b. Keyword and Explore search

1. Use the search box for each keyword. Check both the Accounts and the Reels result tabs.
2. Navigate to `https://www.instagram.com/explore/` and scroll for niche-adjacent formats.
3. When a strong account appears in results, add it to the profile queue in 3a and scroll it properly. One viral video usually sits in a shelf of them.

### 3c. Hashtag scanning

1. Navigate to `https://www.instagram.com/explore/tags/[tag]/`.
2. Scan Top posts first, then Recent for anything climbing fast.
3. Filter to video content. Discard static posts and carousels unless the user asked for them.

Aim for a candidate pool of at least 60 videos before scoring. A smaller pool produces false outliers.

## Step 4. Score virality properly

Raw view counts lie. A 500k-view video from a 4m-follower account is a below-average post. A 500k-view video from a 20k-follower account is the one worth studying.

Calculate two numbers for every candidate:

**Outlier score** = video views / median views of that account's last 20 videos

This is the primary metric. It is the only one that says whether the video beat its own account.

| Outlier score | Read |
|---|---|
| Under 1.5 | Normal. Discard. |
| 1.5 to 3 | Above baseline. Keep if the fit is strong. |
| 3 to 10 | Genuine outlier. The format did the work. |
| Over 10 | Break-out. Study the hook frame by frame. |

**Reach ratio** = video views / account follower count

Use this as the secondary check. Anything over 10 escaped the existing audience and got pushed to non-followers, which is the behaviour worth copying.

Then apply these filters before anything reaches the output:

- Drop videos outside the date window from Step 1.
- Drop accounts where you could not read at least 10 videos, since the median is unreliable below that.
- Drop videos where the outlier score is high only because the account has almost no history.
- Flag, do not drop, anything that looks like paid promotion or a collab post, since the reach is borrowed.

## Step 5. Match to the events

Score each surviving video against every event from Step 2 on three things:

1. **Topic fit.** Does the subject overlap with the event, or can it be bridged in one sentence?
2. **Format transfer.** Can this structure carry the user's message, or does it depend on something they cannot recreate?
3. **Timing.** Is there a run-up window between now and the event date to actually produce it?

Give each video the single best event match and a fit rating of Strong, Workable or Weak. Drop everything rated Weak unless it scores over 10 as an outlier, in which case keep it and mark the fit honestly.

## Step 6. Output

First line before the table:

```
As of [DD/MM/YYYY] — [N] videos scanned across [N] accounts
```

Then a markdown table with these exact columns:

```
| # | Video | Account (followers) | Posted | Views | Outlier Score | Reach Ratio | Hook (first 3 seconds) | Format | Why It Worked | Best Event Match | Fit |
```

Sort by outlier score, highest first. Cap at 20 rows.

Then, and only then, a short section headed `Patterns` with the three to five things the top rows have in common. Hook structure, video length, on-screen text, pacing, caption style. This is the part the user acts on.

No other prose.

## Step 7. Offer the next move

After the Patterns section, ask:

> Want me to script one of these? Give me a row number and I will hand it to the reels-scripting skill to reverse-engineer the video and rewrite it in your voice. Or say "hooks" and I will run hook-generator on the top three patterns.

## Rules

- Never invent view counts, follower counts, dates or links. If a number is not visible, mark the cell `not visible` and carry on.
- Verify the posted date on every video. Instagram shows relative dates like "5w" on grids, so open the post to confirm anything near the edge of the window.
- Outlier score beats raw views every time. Never rank on views alone.
- Never log in on the user's behalf, never accept credentials, and never interact with anything on the platform. This skill reads only. No likes, no follows, no comments, no DMs.
- Respect what the account has made public. Do not attempt to view private accounts or Stories, and do not work around a login wall.
- Do not download video files here. That is the reels-scripting skill's job, and only for a video the user has picked.
- If the browser hits a rate limit or an "unusual activity" warning, stop scrolling immediately, tell the user, and report on the pool you already have.
- Report the real pool size. If only 20 videos passed the filters, say so rather than padding the table with normal posts.
- British English throughout. DD/MM/YYYY date format.
- Never use em dashes.
