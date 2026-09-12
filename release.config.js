/**
 * semantic-release config (spec §25): conventionalcommits preset, npm + GitHub release,
 * docs:rules regenerated into the release so the published reference never drifts.
 */
export default {
  branches: ['main', { name: 'beta', prerelease: true }],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    [
      '@semantic-release/exec',
      { prepareCmd: 'pnpm build && pnpm build:action && pnpm docs:rules' },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'docs/rules.md', 'dist/**'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        // `labels: false` avoids a duplicate-label payload: the plugin defaults to
        // ['semantic-release'] and then concats its own RELEASE_FAIL_LABEL (also
        // 'semantic-release'), which GitHub rejects with "Validation Failed ... Label
        // name invalid" — masking the real release error. The failure issue is still
        // created, labeled with the plugin's built-in 'semantic-release' label.
        labels: false,
      },
    ],
    ['@semantic-release/npm', { npmPublish: true }],
  ],
};
