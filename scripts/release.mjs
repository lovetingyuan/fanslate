import readline from 'node:readline/promises'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

/**
 * @typedef {Object} CommandResult
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Build a Windows-safe command invocation. `git` should bypass the shell so the
 * commit message is preserved exactly, while `npm.cmd` must run through `cmd`.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {{ command: string; args: string[] }}
 */
function resolveInvocation(command, args) {
  if (process.platform !== 'win32') {
    return { command, args }
  }

  if (command === 'npm') {
    const escapedArgs = args.map(escapeWindowsCmdArgument).join(' ')
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `npm ${escapedArgs}`],
    }
  }

  return { command, args }
}

/**
 * Quote a single argument for `cmd.exe /c`.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeWindowsCmdArgument(value) {
  if (value.length === 0) {
    return '""'
  }

  if (!/[ \t"&()^[\]{}=;!'+,`~]/.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Run a command and inherit stdio so the release flow stays transparent.
 * This is used for state-changing steps like build, commit, tag and push.
 *
 * @param {string} command
 * @param {string[]} args
 */
function runCommand(command, args = []) {
  const displayCommand = [command, ...args].join(' ')
  console.log(`==> ${displayCommand}`)
  const invocation = resolveInvocation(command, args)

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${displayCommand}`)
  }
}

/**
 * Run a command and capture output for checks that drive release decisions.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {CommandResult}
 */
function runCommandForOutput(command, args = []) {
  const invocation = resolveInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

/**
 * Only tracked changes block a release so local tool folders like `.agents/`
 * do not interfere with the happy path.
 *
 * @returns {boolean}
 */
function hasTrackedChanges() {
  const workingTree = runCommandForOutput('git', ['diff', '--quiet', '--ignore-submodules', '--'])
  if ((workingTree.status ?? 1) > 1) {
    throw new Error('Failed to inspect working tree changes.')
  }

  const staged = runCommandForOutput('git', [
    'diff',
    '--cached',
    '--quiet',
    '--ignore-submodules',
    '--',
  ])
  if ((staged.status ?? 1) > 1) {
    throw new Error('Failed to inspect staged changes.')
  }

  return workingTree.status === 1 || staged.status === 1
}

/**
 * Normalize common GitHub remote formats into a browsable repository URL.
 *
 * @returns {string}
 */
function getGitHubRepositoryUrl() {
  const remote = runCommandForOutput('git', ['remote', 'get-url', 'origin'])
  if (remote.status !== 0 || remote.stdout.length === 0) {
    throw new Error('Unable to resolve the origin remote.')
  }

  const patterns = [
    /^https:\/\/github\.com\/(?<path>.+?)(?:\.git)?$/,
    /^git@github\.com:(?<path>.+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/(?<path>.+?)(?:\.git)?$/,
  ]

  for (const pattern of patterns) {
    const match = remote.stdout.match(pattern)
    const repoPath = match?.groups?.path
    if (repoPath) {
      return `https://github.com/${repoPath}`
    }
  }

  throw new Error(`The origin remote is not a GitHub repository: ${remote.stdout}`)
}

/**
 * The user enters release notes in one line separated by two spaces, and we
 * convert that compact input into GitHub-friendly bullet points.
 *
 * @param {string} rawChangelog
 * @returns {string}
 */
function changelogToMarkdown(rawChangelog) {
  const entries = rawChangelog
    .split(/\s{2,}/)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)

  if (entries.length === 0) {
    throw new Error('The changelog could not be parsed into release note items.')
  }

  return entries.map(entry => `- ${entry}`).join('\n')
}

/**
 * Open URLs using the current platform default browser.
 *
 * @param {string} url
 */
function openUrl(url) {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [url], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return
  }

  const child = spawn('xdg-open', [url], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

/**
 * Prompt until the user provides a non-empty value.
 *
 * @param {readline.Interface} rl
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function getRequiredInput(rl, prompt) {
  while (true) {
    const input = (await rl.question(`${prompt}: `)).trim()
    if (input.length > 0) {
      return input
    }

    console.log('输入不能为空，请重新输入。')
  }
}

async function main() {
  if (hasTrackedChanges()) {
    throw new Error(
      'Tracked git changes detected. Please commit or stash them before running the release script.',
    )
  }

  const branch = runCommandForOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch.status !== 0 || branch.stdout.length === 0) {
    throw new Error('Unable to determine the current branch.')
  }

  if (branch.stdout === 'HEAD') {
    throw new Error('Detached HEAD is not supported for releases. Please switch to a branch first.')
  }

  const repositoryUrl = getGitHubRepositoryUrl()
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const currentVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
    const version = await getRequiredInput(rl, `请输入新版本号 (当前版本: ${currentVersion})`)
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error('版本号必须符合 SemVer 格式，例如 1.2.3 或 1.2.3-beta.1')
    }

    const tagName = `v${version}`
    const existingTag = runCommandForOutput('git', ['tag', '--list', tagName])
    if (existingTag.status !== 0) {
      throw new Error('Unable to check whether the tag already exists.')
    }
    if (existingTag.stdout.length > 0) {
      throw new Error(`Tag ${tagName} already exists.`)
    }

    const rawChangelog = await getRequiredInput(rl, '请输入更新日志，使用双空格分隔不同条目')
    const releaseNotes = changelogToMarkdown(rawChangelog)

    runCommand('npm', ['version', version, '--no-git-tag-version'])
    runCommand('npm', ['run', 'zip'])
    runCommand('npm', ['run', 'zip:firefox'])

    runCommand('git', ['add', 'package.json', 'package-lock.json'])
    runCommand('git', ['commit', '-m', `chore(release): ${tagName}`])
    runCommand('git', ['tag', '-a', tagName, '-m', `${tagName}\n\n${releaseNotes}`])
    runCommand('git', ['push', 'origin', branch.stdout])
    runCommand('git', ['push', 'origin', tagName])

    const releaseTitle = version
    const releaseUrl =
      `${repositoryUrl}/releases/new?tag=${encodeURIComponent(tagName)}` +
      `&title=${encodeURIComponent(releaseTitle)}` +
      `&body=${encodeURIComponent(releaseNotes)}`

    console.log('==> Opening GitHub Release page')
    openUrl(releaseUrl)

    console.log('==> Opening Chrome Web Store console')
    openUrl('https://chrome.google.com/webstore/devconsole/')

    console.log(`\nRelease flow finished for ${tagName}`)
  } finally {
    rl.close()
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Release failed: ${message}`)
  process.exitCode = 1
})
