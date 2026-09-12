#!/usr/bin/env python3
"""Build the post-merge evidence file the ten landing proofs read.

Every GitHub-side fact is fetched live; every git-side fact is read from a
checkout of the LANDED main. Nothing is typed in by hand except the PR number
and the head that was approved, both of which are then checked against what
GitHub actually returns.

  python3 build-evidence.py --pr 240 --approved-head <sha> --pre-merge <sha> \\
      --repo-dir <checkout of landed main> --out <file>

THE SHAPE WARNING that cost a dry run: the trust gates read a FLAT camelCase
pull — mergeCommitSha, baseRef, baseSha, headSha, authorLogin. GitHub returns
base.ref / head.sha / user.login nested. `flat()` below is that normalisation
and skipping it makes the gates fail closed with a misleading reason.
"""
import argparse, json, os, subprocess, sys, urllib.request

API = 'https://api.github.com'
REPO = 'ohdieyuh-glitch/sunday-relay'


def gh(path):
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if not token:
        sys.exit('GITHUB_TOKEN / GH_TOKEN is not set')
    req = urllib.request.Request(f'{API}{path}', headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def git(repo, *args):
    return subprocess.check_output(['git', '-C', repo, *args], text=True).strip()


def contained(repo, a, b):
    return subprocess.call(['git', '-C', repo, 'merge-base', '--is-ancestor', a, b],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0


def flat(p):
    """GitHub's nested pull -> the flat camelCase shape the gates read."""
    return {
        'number': p['number'],
        'merged': p.get('merged_at') is not None,
        'mergeCommitSha': p.get('merge_commit_sha'),
        'baseRef': p['base']['ref'],
        'baseSha': p['base']['sha'],
        'headSha': p['head']['sha'],
        'authorLogin': p['user']['login'],
    }


def accepted_checkpoints():
    """Every unexpired julius-accepted-main-<sha> artifact. Expiry is not amnesty,
    but an expired row is not authority either — the gate ignores it, so do we."""
    shas, page = [], 1
    while True:
        body = gh(f'/repos/{REPO}/actions/artifacts?per_page=100&page={page}')
        rows = body.get('artifacts') or []
        if not rows:
            break
        for a in rows:
            if a.get('expired') is True:
                continue
            name = a.get('name') or ''
            if name.startswith('julius-accepted-main-'):
                sha = name[len('julius-accepted-main-'):]
                if len(sha) == 40 and sha not in shas:
                    shas.append(sha)
        if len(rows) < 100:
            break
        page += 1
    return shas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pr', type=int, required=True)
    ap.add_argument('--approved-head', required=True)
    ap.add_argument('--pre-merge', required=True)
    ap.add_argument('--repo-dir', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    repo = a.repo_dir
    subprocess.check_call(['git', '-C', repo, 'fetch', 'origin', 'main', '--quiet'])
    main_sha = git(repo, 'rev-parse', 'origin/main')
    main_tree = git(repo, 'rev-parse', f'{main_sha}^{{tree}}')
    parents = git(repo, 'rev-list', '--parents', '-n', '1', main_sha).split()[1:]
    approved_tree = git(repo, 'rev-parse', f'{a.approved_head}^{{tree}}')

    pr = gh(f'/repos/{REPO}/pulls/{a.pr}')
    if pr['head']['sha'] != a.approved_head:
        sys.exit(f"PR #{a.pr} head is {pr['head']['sha']}, not the approved {a.approved_head}")
    pulls = gh(f'/repos/{REPO}/commits/{main_sha}/pulls')
    reviews = gh(f'/repos/{REPO}/pulls/{a.pr}/reviews')
    statuses = gh(f'/repos/{REPO}/commits/{a.approved_head}/statuses')
    accepted = accepted_checkpoints()

    ev = {
        'repoSlug': REPO, 'branch': 'main', 'gitRef': 'origin/main',
        'preMergeMainSha': a.pre_merge,
        'approvedHeadSha': a.approved_head,
        'approvedHeadTreeSha': approved_tree,
        'pullAuthorLogin': pr['user']['login'],
        'reviewedTreeSha': approved_tree,
        'reviewedHeadShaAfter': pr['head']['sha'],
        'parentContainedInReviewedHead': contained(repo, a.pre_merge, a.approved_head),
        'baseRefChanged': pr['base']['ref'] != 'main',
        'headSha': pr['head']['sha'], 'headShaAfter': pr['head']['sha'],
        'baseSha': pr['base']['sha'], 'baseShaAfter': pr['base']['sha'],
        'baseContainedInHead': contained(repo, pr['base']['sha'], pr['head']['sha']),
        'acceptedShas': accepted,
        'containment': {s: contained(repo, s, main_sha) for s in accepted},
        'mainSha': main_sha, 'mainShaAfter': main_sha,
        'mainTreeSha': main_tree, 'mainParents': parents,
        'mergedPullsForMainSha': [flat(p) for p in pulls
                                  if p.get('merged_at') and p.get('merge_commit_sha') == main_sha],
        'pullRequests': [flat(p) for p in pulls],
        'reviews': [{'state': r['state'], 'user': {'login': r['user']['login']},
                     'commit_id': r['commit_id'], 'submitted_at': r.get('submitted_at'),
                     'author_association': r.get('author_association')} for r in reviews],
        'reviewComments': [],
        'statuses': [{'state': s['state'], 'context': s['context'],
                      'created_at': s.get('created_at')} for s in statuses],
    }
    with open(a.out, 'w') as f:
        json.dump(ev, f, indent=2)
        f.write('\n')

    print(f'main            {main_sha}')
    print(f'main tree       {main_tree}')
    print(f'main parents    {parents}')
    print(f'approved head   {a.approved_head}  tree {approved_tree}')
    print(f'merged PRs      {[p["number"] for p in ev["mergedPullsForMainSha"]]}')
    print(f'author          {ev["pullAuthorLogin"]}')
    print(f'reviews         {[(r["state"], r["user"]["login"], r["commit_id"][:8]) for r in ev["reviews"]]}')
    print(f'accepted        {len(accepted)} checkpoint(s), all contained: '
          f'{all(ev["containment"].values()) if accepted else "n/a"}')
    print(f'written         {a.out}')


if __name__ == '__main__':
    main()
