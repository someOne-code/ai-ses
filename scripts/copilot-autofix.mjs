const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiBase = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
const prNumber = Number.parseInt(process.env.PR_NUMBER ?? "", 10);
const triggerActor = process.env.TRIGGER_ACTOR ?? "workflow-dispatch";
const triggerAssociation = (process.env.TRIGGER_AUTHOR_ASSOCIATION ?? "").toUpperCase();
const triggerCommentId = Number.parseInt(process.env.TRIGGER_COMMENT_ID ?? "", 10);

if (!token) {
  throw new Error("Missing GITHUB_TOKEN.");
}

if (!repository || !repository.includes("/")) {
  throw new Error("Missing or invalid GITHUB_REPOSITORY.");
}

if (!Number.isInteger(prNumber) || prNumber <= 0) {
  throw new Error("Missing or invalid PR_NUMBER.");
}

const [owner, repo] = repository.split("/");
const allowedAssociations = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const configuredCopilotLogins = new Set(
  (process.env.COPILOT_REVIEW_LOGINS ??
    "copilot-pull-request-reviewer[bot],github-copilot[bot],copilot[bot]")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

function normalizeWhitespace(value) {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function isCopilotLogin(login) {
  if (!login) {
    return false;
  }

  const normalized = login.toLowerCase();
  return configuredCopilotLogins.has(normalized) || normalized.includes("copilot");
}

async function githubRequest(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function githubGraphql(query, variables) {
  const response = await fetch(`${apiBase}/graphql`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

async function listAllIssueComments() {
  const comments = [];
  let page = 1;

  while (true) {
    const pageItems = await githubRequest(
      "GET",
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    );

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    comments.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }

    page += 1;
  }

  return comments;
}

async function listReviewThreads() {
  const query = `
    query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 50, after: $after) {
            nodes {
              isResolved
              isOutdated
              path
              line
              startLine
              comments(first: 20) {
                nodes {
                  body
                  url
                  author {
                    login
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  const threads = [];
  let after = null;

  while (true) {
    const data = await githubGraphql(query, {
      owner,
      repo,
      number: prNumber,
      after,
    });

    const connection = data.repository?.pullRequest?.reviewThreads;

    if (!connection) {
      break;
    }

    threads.push(...(connection.nodes ?? []));

    if (!connection.pageInfo?.hasNextPage) {
      break;
    }

    after = connection.pageInfo.endCursor;
  }

  return threads;
}

async function postIssueComment(body) {
  return githubRequest("POST", `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    body,
  });
}

async function addReactionToTriggerComment(content) {
  if (!Number.isInteger(triggerCommentId) || triggerCommentId <= 0) {
    return;
  }

  await githubRequest(
    "POST",
    `/repos/${owner}/${repo}/issues/comments/${triggerCommentId}/reactions`,
    { content },
  );
}

if (triggerAssociation && !allowedAssociations.has(triggerAssociation)) {
  console.log(
    `Ignoring /copilot-autofix from ${triggerActor}; association ${triggerAssociation} is not allowed.`,
  );
  process.exit(0);
}

const pullRequest = await githubRequest("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);

if (!pullRequest.draft) {
  await addReactionToTriggerComment("eyes");
  await postIssueComment(
    `Skipping \`/copilot-autofix\`: PR #${prNumber} is not a draft pull request. Keep the PR in draft before using this command.`,
  );
  process.exit(0);
}

const headSha = pullRequest.head?.sha;

if (!headSha) {
  throw new Error(`PR #${prNumber} is missing head SHA information.`);
}

const existingComments = await listAllIssueComments();
const marker = `<!-- copilot-autofix-request sha=${headSha} -->`;

if (existingComments.some((comment) => typeof comment.body === "string" && comment.body.includes(marker))) {
  await addReactionToTriggerComment("eyes");
  await postIssueComment(
    `Autofix was already requested for PR #${prNumber} at head SHA \`${headSha.slice(0, 7)}\`. Push a new commit or run the fix manually if you need another pass.`,
  );
  process.exit(0);
}

const reviewThreads = await listReviewThreads();

const actionableThreads = reviewThreads
  .filter((thread) => !thread.isResolved && !thread.isOutdated)
  .map((thread) => {
    const comments = thread.comments?.nodes ?? [];
    const copilotComment = comments.find((comment) => isCopilotLogin(comment.author?.login));

    if (!copilotComment) {
      return null;
    }

    return {
      path: thread.path,
      line: thread.line ?? thread.startLine ?? null,
      body: normalizeWhitespace(copilotComment.body ?? ""),
      url: copilotComment.url,
    };
  })
  .filter(Boolean);

if (actionableThreads.length === 0) {
  await addReactionToTriggerComment("eyes");
  await postIssueComment(
    `No unresolved Copilot review threads were found for PR #${prNumber}. Nothing was forwarded to \`@copilot\`.`,
  );
  process.exit(0);
}

const maxForwardedThreads = 15;
const forwardedThreads = actionableThreads.slice(0, maxForwardedThreads);
const remainingThreadCount = actionableThreads.length - forwardedThreads.length;

const feedbackLines = forwardedThreads.map((thread, index) => {
  const location = thread.path
    ? `\`${thread.path}${thread.line ? `:${thread.line}` : ""}\``
    : "general PR feedback";
  const body = truncate(thread.body, 500);
  const url = thread.url ? ` ([thread](${thread.url}))` : "";

  return `${index + 1}. ${location} ${body}${url}`;
});

const commentBody = [
  marker,
  "@copilot Please address the unresolved Copilot review feedback below on this draft pull request.",
  "",
  "Constraints:",
  "- Keep the PR in draft.",
  "- Stay inside the current PR scope.",
  "- Follow `.github/copilot-instructions.md` and `AGENTS.md`.",
  "- Preserve backend as the source of truth.",
  "- Do not move durable business logic into `n8n`, prompts, or provider dashboards.",
  "- Do not introduce single-tenant assumptions or fabricated listing details.",
  "- After making changes, reply with the exact tests or checks you ran.",
  "",
  "Feedback to address:",
  ...feedbackLines,
  ...(remainingThreadCount > 0
    ? [
        "",
        `There are ${remainingThreadCount} additional unresolved Copilot review threads. Review and address them too even though they are not expanded here.`,
      ]
    : []),
  "",
  `Triggered by @${triggerActor} for head SHA \`${headSha.slice(0, 7)}\`.`,
].join("\n");

await addReactionToTriggerComment("rocket");
await postIssueComment(commentBody);

console.log(
  `Forwarded ${forwardedThreads.length} Copilot review thread(s) for PR #${prNumber} at ${headSha.slice(0, 7)}.`,
);
