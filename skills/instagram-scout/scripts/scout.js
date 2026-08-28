#!/usr/bin/env node
/*
 * instagram-scout — Apify data path.
 *
 * Pulls recent posts for the accounts and hashtags you name, works out each
 * account's own median view count, and ranks every video by how far it beat
 * that baseline. Metrics only. It cannot see hooks or thumbnails, so treat the
 * output as a shortlist to watch rather than a finished answer.
 *
 * Usage:
 *   npm install apify-client
 *   export APIFY_API_TOKEN=your_token
 *   node scout.js --handles=nike,gymshark --days=90 --out=scout.md
 *
 * Flags:
 *   --handles=a,b,c    Instagram handles to scroll. The strongest input.
 *   --hashtags=x,y     Hashtags to scan, without the # sign.
 *   --days=90          Date window. Use 0 for all time.
 *   --limit=30         Posts to pull per account. Minimum 10 for a valid median.
 *   --out=scout.md     Where to write the table. Defaults to scout.md.
 */

const fs = require('fs');

const MIN_POSTS_FOR_MEDIAN = 10;
const PROFILE_ACTOR = 'apify/instagram-scraper';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  const list = (v) => (v ? v.split(',').map((s) => s.trim().replace(/^[@#]/, '')).filter(Boolean) : []);
  return {
    handles: list(args.handles),
    hashtags: list(args.hashtags),
    days: args.days === undefined ? 90 : Number(args.days),
    limit: Math.max(Number(args.limit) || 30, MIN_POSTS_FOR_MEDIAN),
    out: args.out || 'scout.md',
  };
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Apify returns view counts under different keys depending on the actor
// version and the post type. Read them in order rather than assuming one.
function viewsOf(item) {
  const candidates = [item.videoPlayCount, item.videoViewCount, item.playCount, item.viewCount];
  const found = candidates.find((v) => typeof v === 'number' && v > 0);
  return found === undefined ? null : found;
}

function isVideo(item) {
  return item.type === 'Video' || item.productType === 'clips' || Boolean(item.videoUrl);
}

function firstLine(caption) {
  if (!caption) return '';
  return caption.split('\n')[0].slice(0, 90).replace(/\|/g, '/');
}

function ddmmyyyy(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function runActor(client, input) {
  const run = await client.actor(PROFILE_ACTOR).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

async function scrapeHandle(client, handle, limit) {
  const items = await runActor(client, {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: 'posts',
    resultsLimit: limit,
    addParentData: true,
  });
  // followersCount rides along on the parent data. If it is absent we still
  // rank on outlier score and simply report the reach ratio as unavailable.
  const followers = items.map((i) => i.ownerFollowersCount ?? i.followersCount).find((v) => typeof v === 'number') ?? null;
  return { handle, followers, items };
}

async function scrapeHashtag(client, tag, limit) {
  const items = await runActor(client, {
    search: tag,
    searchType: 'hashtag',
    resultsType: 'posts',
    resultsLimit: limit,
  });
  return { handle: `#${tag}`, followers: null, items };
}

function scoreAccount({ handle, followers, items }, cutoff) {
  const videos = items.filter(isVideo);
  const withViews = videos.filter((v) => viewsOf(v) !== null);

  if (withViews.length < MIN_POSTS_FOR_MEDIAN) {
    return { handle, skipped: `only ${withViews.length} videos with readable view counts, need ${MIN_POSTS_FOR_MEDIAN} for a reliable median`, rows: [] };
  }

  const baseline = median(withViews.map(viewsOf));
  const rows = [];

  for (const item of withViews) {
    const posted = new Date(item.timestamp);
    if (cutoff && posted < cutoff) continue;

    const views = viewsOf(item);
    rows.push({
      url: item.url || `https://www.instagram.com/p/${item.shortCode}/`,
      account: handle,
      followers,
      posted: ddmmyyyy(item.timestamp),
      views,
      outlier: views / baseline,
      reach: followers ? views / followers : null,
      caption: firstLine(item.caption),
      likes: item.likesCount ?? null,
      comments: item.commentsCount ?? null,
    });
  }

  return { handle, baseline, videosRead: withViews.length, rows };
}

function toMarkdown(rows, meta) {
  const header = [
    '| # | Video | Account (followers) | Posted | Views | Outlier | Reach ratio | Caption opener |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const body = rows.map((r, i) => {
    const followers = r.followers ? r.followers.toLocaleString('en-GB') : 'not visible';
    const reach = r.reach === null ? 'not visible' : r.reach.toFixed(1);
    return `| ${i + 1} | [link](${r.url}) | ${r.account} (${followers}) | ${r.posted} | ${r.views.toLocaleString('en-GB')} | ${r.outlier.toFixed(1)}x | ${reach} | ${r.caption} |`;
  });
  return [meta, '', ...header, ...body, ''].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const token = process.env.APIFY_API_TOKEN;

  if (!token) {
    console.error('APIFY_API_TOKEN is not set. Run: export APIFY_API_TOKEN=your_token');
    process.exit(1);
  }
  if (!opts.handles.length && !opts.hashtags.length) {
    console.error('Give me something to search: --handles=a,b,c and/or --hashtags=x,y');
    process.exit(1);
  }

  // Required here rather than at the top so the scoring logic stays importable
  // and testable without the dependency installed.
  let ApifyClient;
  try {
    ({ ApifyClient } = require('apify-client'));
  } catch (err) {
    console.error('apify-client is not installed. Run: npm install apify-client');
    process.exit(1);
  }

  const client = new ApifyClient({ token });
  const cutoff = opts.days > 0 ? new Date(Date.now() - opts.days * 86400000) : null;

  const targets = [
    ...opts.handles.map((h) => () => scrapeHandle(client, h, opts.limit)),
    ...opts.hashtags.map((t) => () => scrapeHashtag(client, t, opts.limit)),
  ];

  const allRows = [];
  const skipped = [];
  let accountsRead = 0;

  for (const fetchTarget of targets) {
    let scraped;
    try {
      scraped = await fetchTarget();
    } catch (err) {
      skipped.push(`scrape failed: ${err.message}`);
      continue;
    }

    const scored = scoreAccount(scraped, cutoff);
    if (scored.skipped) {
      skipped.push(`${scored.handle}: ${scored.skipped}`);
      continue;
    }
    accountsRead += 1;
    allRows.push(...scored.rows);
    console.error(`${scored.handle}: ${scored.videosRead} videos read, median ${Math.round(scored.baseline).toLocaleString('en-GB')} views`);
  }

  // Anything at or below its own account average is a normal post, not a find.
  const outliers = allRows.filter((r) => r.outlier >= 1.5).sort((a, b) => b.outlier - a.outlier).slice(0, 20);

  const window = opts.days > 0 ? `last ${opts.days} days` : 'all time';
  const meta = `As of ${ddmmyyyy(new Date().toISOString())} — ${allRows.length} videos scanned across ${accountsRead} accounts, ${window}`;

  let output = toMarkdown(outliers, meta);
  if (!outliers.length) {
    output += '\nNo video beat 1.5x its account baseline in this window. Widen the window or add more accounts.\n';
  }
  if (skipped.length) {
    output += `\n## Skipped\n\n${skipped.map((s) => `- ${s}`).join('\n')}\n`;
  }

  fs.writeFileSync(opts.out, output);
  console.log(output);
  console.error(`\nWritten to ${opts.out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { median, viewsOf, isVideo, scoreAccount, parseArgs, ddmmyyyy };
