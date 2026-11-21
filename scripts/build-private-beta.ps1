$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    $commit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the source revision.' }
    $trackedChanges = @(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the source status.' }
    $config = Get-Content -Raw -LiteralPath 'src-tauri/tauri.private-beta.conf.json' | ConvertFrom-Json
    $version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
    $notices = (Get-FileHash -LiteralPath 'THIRD-PARTY-NOTICES.txt').Hash

    & npm.cmd run notices:check
    if ($LASTEXITCODE -ne 0) { throw 'Third-party notices check failed.' }
    & .\node_modules\.bin\tauri.cmd build --bundles nsis --no-sign --ci --config 'src-tauri/tauri.private-beta.conf.json'
    if ($LASTEXITCODE -ne 0) { throw 'Beta build failed.' }

    $filename = "$($config.productName)_${version}_x64-setup.exe"
    $target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri/target' }
    $built = Get-Item -LiteralPath (Join-Path $target ('release/bundle/nsis/' + $filename))
    $nsis = Get-Content -Raw -LiteralPath (Join-Path $target 'release/nsis/x64/installer.nsi')
    foreach ($marker in @(
        "!define ARCH `"x64`"",
        "!define BUNDLEID `"$($config.identifier)`"",
        "!define MAINBINARYNAME `"$($config.mainBinaryName)`"",
        "!define VERSION `"$version`"",
        'THIRD-PARTY-NOTICES.txt',
        'ATTRIBUTION.md',
        'LICENSE',
        'private-beta-install.nsh'
    )) {
        if (!$nsis.Contains($marker)) { throw "Generated installer is missing $marker" }
    }

    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $serial = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $dir = Join-Path 'target-private-beta/candidates' "$stamp-$($commit.Substring(0, 12))-$serial"
    New-Item -ItemType Directory -Path $dir | Out-Null
    $installer = Join-Path $dir $filename
    $sha256 = (Get-FileHash -LiteralPath $built.FullName).Hash
    Copy-Item -LiteralPath $built.FullName -Destination $installer
    if ((Get-FileHash -LiteralPath $installer).Hash -ne $sha256) {
        throw 'The archived installer differs from the build output.'
    }
    $manifest = [ordered]@{
        product = $config.productName
        identifier = $config.identifier
        version = $version
        architecture = 'x64'
        sourceCommit = $commit
        trackedChanges = ($trackedChanges.Count -gt 0)
        installer = $filename
        bytes = $built.Length
        sha256 = $sha256
        signature = (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
        noticesSha256 = $notices
        licenseSha256 = (Get-FileHash -LiteralPath 'LICENSE').Hash
        attributionSha256 = (Get-FileHash -LiteralPath 'ATTRIBUTION.md').Hash
    }
    $manifest | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $dir 'manifest.json')
    Write-Output (Get-Item -LiteralPath $installer).FullName
    $manifest | ConvertTo-Json -Compress
}
finally {
    Pop-Location
}
