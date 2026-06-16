import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const TARGET_REPO = process.env.GH_REPO || "";
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN || "";

if (!TARGET_REPO) {
  console.error(
    "请设置 GH_REPO=owner/repo 指定目标仓库"
  );
  process.exit(1);
}
if (!TOKEN) {
  console.error(
    "请设置 GH_PAT（或 GITHUB_TOKEN）环境变量\n" +
    "  GitHub Action: 将 GH_PAT 存入仓库 Secrets\n" +
    "  本地: GH_PAT=ghp_xxx node backup/backup.mjs"
  );
  process.exit(1);
}

const API =
  process.env.GITHUB_API_BASE ||
  "https://api.github.com";
const MARKER = "<!-- wiki:";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchAllIssues() {
  const all = [];
  let page = 1;
  while (true) {
    const q = encodeURIComponent(
      `repo:${TARGET_REPO}+"${MARKER}"+in:body` +
      `+type:issue+state:open`
    );
    const url =
      `${API}/search/issues?q=${q}&sort=updated` +
      `&order=desc&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(
        `GitHub API 返回 HTTP ${res.status}`
      );
      break;
    }
    const data = await res.json();
    if (!data.items?.length) break;
    all.push(...data.items);
    if (all.length >= data.total_count) break;
    page++;
  }
  return all;
}

function parseSlug(body) {
  const m = body.match(/^<!-- wiki:([^ #>]+)/);
  return m ? m[1] : null;
}

function parseTags(body) {
  const m = body.match(/^<!-- wiki:[^ ]+ (.*)-->/);
  if (!m) return [];
  return m[1]
    .split(/\s+/)
    .filter((t) => t.startsWith("#"))
    .map((t) => t.slice(1))
    .filter(Boolean);
}

function stripMarker(body) {
  return body
    .replace(/^<!-- wiki:[^ ]+( [^-]*)?-->\n?/, "")
    .trim();
}

async function main() {
  console.log(`\n目标仓库: ${TARGET_REPO}`);
  console.log(`API 端点:  ${API}`);

  const issues = await fetchAllIssues();
  console.log(`找到 ${issues.length} 个 wiki Issue\n`);

  const backupDir = join(process.cwd(), "backup");
  await mkdir(backupDir, { recursive: true });

  const manifest = {
    repo: TARGET_REPO,
    updatedAt: new Date().toISOString(),
    totalPages: issues.length,
    pages: [],
  };

  for (const issue of issues) {
    const slug =
      parseSlug(issue.body) ||
      `issue-${issue.number}`;
    const tags = parseTags(issue.body || "");
    const content = stripMarker(issue.body || "");
    const tagYaml = tags.length
      ? `[${tags.join(", ")}]`
      : "[]";
    const titleSafe = issue.title
      .replace(/"/g, '\\"');

    const frontmatter =
      `---\n` +
      `slug: ${slug}\n` +
      `title: "${titleSafe}"\n` +
      `tags: ${tagYaml}\n` +
      `createdAt: ${issue.created_at}\n` +
      `updatedAt: ${issue.updated_at}\n` +
      `---\n\n`;

    const filePath = join(backupDir, `${slug}.md`);
    await writeFile(
      filePath, frontmatter + content, "utf-8"
    );
    console.log(`  ✓ ${slug}.md`);

    manifest.pages.push({
      slug,
      title: issue.title,
      tags,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    });
  }

  const indexPath = join(backupDir, "index.json");
  await writeFile(
    indexPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );
  console.log(
    `\n备份完成: ${manifest.pages.length} 个页面`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
